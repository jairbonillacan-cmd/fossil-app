# Fossil performance budgets (docs/DOD.md §Rendimiento, issue #78).
# Measures, with N repetitions and percentiles: installer size, cold and warm
# time to visible window, RAM of the process tree (including msedgewebview2
# children), and — with -Bench — the criterion scenarios (search 10k, corpus
# import, 5k-block document). Declares the hardware it ran on. Writes
# perf-report.md and perf-report.json (schema_version 1, fixed ordered keys)
# and exits 1 if any budget is exceeded. Compatible with PowerShell 5.1 and 7.
param(
    [double]$MaxInstallerMB = 30,
    [double]$MaxStartupSeconds = 1.5,
    [double]$MaxRamMB = 200,
    [double]$MaxSearchMs = 50,
    # Total launches: #1 counts as cold, #2..N as warm (OS caches stay warm
    # without admin rights; see docs/PERFORMANCE.md).
    [int]$Runs = 5,
    # Also run the criterion benches of fossil-core (slower; needs cargo).
    [switch]$Bench,
    [switch]$PrintPathsOnly
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
. (Join-Path $PSScriptRoot "lib\perf-stats.ps1")

$targetDir = if (-not [string]::IsNullOrWhiteSpace($env:CARGO_TARGET_DIR)) {
    $env:CARGO_TARGET_DIR
} else {
    Join-Path $root "target"
}
$nsisDir = Join-Path $targetDir "release\bundle\nsis"
$exe = Join-Path $targetDir "release\fossil-desktop.exe"
if ($PrintPathsOnly) {
    Write-Output "nsisDir=$nsisDir"
    Write-Output "exe=$exe"
    exit 0
}
if ($Runs -lt 2) {
    Write-Error "-Runs needs at least 2 (one cold launch + one warm launch)."
}

# --- 1) Installer size -------------------------------------------------------
$installer = Get-ChildItem -Path $nsisDir -Filter "*.exe" -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
if ($null -eq $installer) {
    Write-Error "No NSIS installer found under $nsisDir. Run 'pnpm.cmd build' first."
}

# --- Window detection + process-tree RAM --------------------------------------
Add-Type @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public class FossilWinEnum {
    public delegate bool EnumProc(IntPtr h, IntPtr l);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);

    public static bool HasVisibleWindow(uint targetPid, string title) {
        bool found = false;
        EnumWindows((h, l) => {
            uint wpid = 0;
            GetWindowThreadProcessId(h, out wpid);
            if (wpid == targetPid && IsWindowVisible(h)) {
                var sb = new StringBuilder(256);
                GetWindowText(h, sb, 256);
                if (sb.ToString() == title) {
                    found = true;
                    return false;
                }
            }
            return true;
        }, IntPtr.Zero);
        return found;
    }
}
'@
if (-not (Test-Path $exe)) {
    Write-Error "Release binary not found at $exe. Run 'pnpm.cmd build' first."
}

# The single-instance plugin and the WebView2 user-data lock need the previous
# tree fully gone before the next launch can survive: wait it out, don't guess.
function Stop-FossilInstances {
    Get-Process fossil-desktop -ErrorAction SilentlyContinue |
        Where-Object { $_.Path -eq $exe } |
        Stop-Process -Force -ErrorAction SilentlyContinue
    for ($i = 0; $i -lt 100; $i++) {
        $left = Get-Process fossil-desktop -ErrorAction SilentlyContinue |
            Where-Object { $_.Path -eq $exe }
        if ($null -eq $left) { break }
        Start-Sleep -Milliseconds 100
    }
    Start-Sleep -Milliseconds 500
}

function Get-DescendantIds([int]$ParentId) {
    $children = Get-CimInstance Win32_Process -Filter "ParentProcessId=$ParentId" -ErrorAction SilentlyContinue
    $ids = @()
    foreach ($c in $children) {
        $ids += [int]$c.ProcessId
        $ids += Get-DescendantIds ([int]$c.ProcessId)
    }
    return $ids
}

# Private commit per process: summing WorkingSet64 across processes double
# counts shared pages (DLLs, GPU buffers) per webview child; private bytes do
# not overlap and upper-bound what the tree actually holds.
function Get-TreeRamMb([int]$RootPid) {
    $treeIds = @($RootPid) + (Get-DescendantIds $RootPid)
    $total = 0.0
    $detail = @()
    foreach ($id in $treeIds) {
        $p = Get-Process -Id $id -ErrorAction SilentlyContinue
        if ($null -ne $p) {
            $mb = [math]::Round($p.PrivateMemorySize64 / 1MB, 1)
            $total += $mb
            $detail += "$($p.Name): $mb MB"
        }
    }
    return @([math]::Round($total, 1), ($detail -join ' · '))
}

# --- 2) Repeated launches: cold #1, warm #2..Runs -----------------------------
[FossilWinEnum]::HasVisibleWindow(0, "Fossil") | Out-Null   # warm up JIT/marshaling

$coldSamples = @()
$warmSamples = @()
$ramSamples = @()
$lastTreeDetail = ""
for ($i = 1; $i -le $Runs; $i++) {
    Stop-FossilInstances
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $proc = Start-Process -FilePath $exe -PassThru
    $target = [uint32]$proc.Id
    $visible = $false
    while ($sw.ElapsedMilliseconds -lt 30000) {
        if ([FossilWinEnum]::HasVisibleWindow($target, "Fossil")) {
            $visible = $true
            break
        }
        if ($proc.HasExited) { break }
        Start-Sleep -Milliseconds 15
    }
    $sw.Stop()
    if (-not $visible) {
        Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
        Stop-FossilInstances
        # The single-instance plugin is app-scoped, not path-scoped: a dev
        # instance from any worktree makes fresh launches exit immediately.
        $other = Get-Process fossil-desktop -ErrorAction SilentlyContinue |
            Where-Object { $_.Path -and $_.Path -ne $exe } | Select-Object -First 1
        if ($null -ne $other) {
            $lockMessage = ("Launch {0} exited with no window: another Fossil instance (pid {1}, {2}) " +
                "holds the single-instance lock (e.g. a pnpm dev session). Close it and retry.") -f
                $i, $other.Id, $other.Path
            Write-Error $lockMessage
        }
        Write-Error "Fossil window did not become visible within 30 s (launch $i of $Runs)."
    }
    $seconds = [math]::Round($sw.Elapsed.TotalSeconds, 3)
    if ($i -eq 1) { $coldSamples += $seconds } else { $warmSamples += $seconds }

    Start-Sleep -Seconds 3   # let the webview settle
    $ram = Get-TreeRamMb $proc.Id
    $ramSamples += [double]$ram[0]
    $lastTreeDetail = $ram[1]
    Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
}
Stop-FossilInstances

# --- 3) Criterion scenarios (optional) -----------------------------------------
# Median of criterion's estimates.json (nanoseconds) for one bench function.
function Get-CriterionMedianMs([string]$Group, [string]$Function) {
    $file = Join-Path (Join-Path $targetDir "criterion") "$Group\$Function\new\estimates.json"
    if (-not (Test-Path $file)) { return $null }
    try {
        $estimates = Get-Content $file -Raw | ConvertFrom-Json
        return [math]::Round($estimates.median.point_estimate / 1e6, 2)
    } catch {
        Write-Warning "Could not parse $file"
        return $null
    }
}

if ($Bench) {
    if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
        Write-Warning "-Bench requested but cargo is not on PATH; skipping bench scenarios."
    } else {
        Push-Location $root
        try {
            foreach ($bench in @("search_10k", "import_corpus")) {
                & cargo bench -p fossil-core --bench $bench -- --quick --noplot
                if ($LASTEXITCODE -ne 0) {
                    Write-Warning "cargo bench $bench failed (exit $LASTEXITCODE); its metrics stay null."
                }
            }
        } finally {
            Pop-Location
        }
    }
}
# Only with -Bench: stale estimates.json from older runs must never pose as
# this run's measurements.
if ($Bench) {
    $searchMs = Get-CriterionMedianMs "r1_search_10k" "search_fts_10k"
    $importPageMs = Get-CriterionMedianMs "r1_import_corpus" "import_page"
    $importCorpus1kMs = Get-CriterionMedianMs "r1_import_corpus" "import_corpus_1k_fresh_vault"
    $doc5kLoadMs = Get-CriterionMedianMs "r1_doc_5k" "load_doc_5k"
    $doc5kIndexMs = Get-CriterionMedianMs "r1_doc_5k" "index_doc_5k"
}

# --- 4) Hardware (CIM/WMI) ------------------------------------------------------
$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
$system = Get-CimInstance Win32_ComputerSystem
$osInfo = Get-CimInstance Win32_OperatingSystem
$disks = Get-CimInstance -ClassName MSFT_PhysicalDisk -Namespace root\Microsoft\Windows\Storage -ErrorAction SilentlyContinue
$diskTypes = @($disks | ForEach-Object {
    if ($_.BusType -eq 17) { "NVMe" }
    elseif ($_.MediaType -eq 4) { "SSD" }
    elseif ($_.MediaType -eq 3) { "HDD" }
    else { "Unknown" }
} | Sort-Object -Unique)
$hardware = [pscustomobject]@{
    cpu = (($cpu.Name -replace '\s+', ' ').Trim())
    cores_physical = [int]$cpu.NumberOfCores
    cores_logical = [int]$cpu.NumberOfLogicalProcessors
    ram_total_gb = [math]::Round($system.TotalPhysicalMemory / 1GB, 1)
    disk_types = if ($diskTypes.Count -gt 0) { $diskTypes -join "+" } else { "Unknown" }
    os = "$($osInfo.Caption) build $($osInfo.BuildNumber)"
}

# --- 5) Metrics, JSON and report -------------------------------------------------
# $Values may arrive with a single $null (a bench that did not run): casting
# it to [double[]] would silently turn it into 0.0 and fake a passing metric,
# so nulls are dropped before any statistic.
function New-Metric([string]$Unit, [object]$Budget, $Values) {
    $vals = [double[]]@($Values | Where-Object { $null -ne $_ })
    $p50 = Get-Percentile $vals 50
    $pass = if ($null -eq $Budget -or $null -eq $p50) { $null } else { [bool]($p50 -lt $Budget) }
    return [pscustomobject]@{
        count = @($vals).Count
        p50 = $p50
        p95 = Get-Percentile $vals 95
        max = if (@($vals).Count -gt 0) { [double]($vals | Measure-Object -Maximum).Maximum } else { $null }
        unit = $Unit
        budget = $Budget
        pass = $pass
    }
}

$installerMB = [math]::Round($installer.Length / 1MB, 2)
$metrics = [pscustomobject]@{
    installer_mb = New-Metric "MB" $MaxInstallerMB @($installerMB)
    startup_cold_s = New-Metric "s" $MaxStartupSeconds $coldSamples
    startup_warm_s = New-Metric "s" $MaxStartupSeconds $warmSamples
    ram_rest_mb = New-Metric "MB" $MaxRamMB $ramSamples
    search_10k_ms = New-Metric "ms" $MaxSearchMs @($searchMs)
    import_page_ms = New-Metric "ms" $null @($importPageMs)
    import_corpus_1k_fresh_vault_ms = New-Metric "ms" $null @($importCorpus1kMs)
    doc_5k_load_ms = New-Metric "ms" $null @($doc5kLoadMs)
    doc_5k_index_ms = New-Metric "ms" $null @($doc5kIndexMs)
}

$gitCommit = $null
try {
    $gitCommit = (& git rev-parse HEAD 2>$null)
    if ($LASTEXITCODE -ne 0) { $gitCommit = $null }
} catch { $gitCommit = $null }

$json = [pscustomobject]@{
    schema_version = 1
    generated_at_utc = (Get-Date).ToUniversalTime().ToString("yyyy-MM-dd'T'HH:mm:ss'Z'")
    git_commit = $gitCommit
    runs = [pscustomobject]@{ cold = 1; warm = $Runs - 1 }
    hardware = $hardware
    budgets = [pscustomobject]@{
        installer_mb = $MaxInstallerMB
        startup_cold_s = $MaxStartupSeconds
        startup_warm_s = $MaxStartupSeconds
        ram_rest_mb = $MaxRamMB
        search_10k_ms = $MaxSearchMs
    }
    metrics = $metrics
}
$json | ConvertTo-Json -Depth 6 | Out-File -FilePath (Join-Path $root "perf-report.json") -Encoding utf8

$names = [ordered]@{
    installer_mb = "Installer size ($($installer.Name))"
    startup_cold_s = "Startup to visible window (cold, 1 run)"
    startup_warm_s = "Startup to visible window (warm, $($Runs - 1) runs)"
    ram_rest_mb = "RAM at rest (private commit, process tree)"
    search_10k_ms = "Search in 10k pages (criterion median)"
    import_page_ms = "Import one page (create + doc + index)"
    import_corpus_1k_fresh_vault_ms = "Import 1k-page corpus (fresh vault)"
    doc_5k_load_ms = "Load 5k-block document"
    doc_5k_index_ms = "Index 5k-block document"
}
$lines = @()
$lines += "## Presupuestos de rendimiento (perf)"
$lines += ""
$lines += "| Métrica | p50 | p95 | máx | Presupuesto (p50) | Estado |"
$lines += "|---|---|---|---|---|---|"
foreach ($key in $names.Keys) {
    $m = $metrics.$key
    $fmt = { param($v) if ($null -eq $v) { "—" } else { "$v $($m.unit)" } }
    $budgetCell = if ($null -eq $m.budget) { "—" } else { "< $($m.budget) $($m.unit)" }
    $mark = if ($null -eq $m.pass) { "info" } elseif ($m.pass) { "OK" } else { "**FUERA**" }
    $lines += "| $($names[$key]) | $(& $fmt $m.p50) | $(& $fmt $m.p95) | $(& $fmt $m.max) | $budgetCell | $mark |"
}
$lines += ""
$benchNote = if ($Bench) { "criterion (`--quick`)" } else { "omitidas (usa -Bench)" }
$lines += "Corridas: 1 fría + $($Runs - 1) calientes · Escenarios de bench: $benchNote"
$lines += "Hardware: $($hardware.cpu) · núcleos $($hardware.cores_physical)/$($hardware.cores_logical) · RAM $(
    $hardware.ram_total_gb) GB · disco $($hardware.disk_types) · $($hardware.os)"
$lines += "Detalle del árbol de procesos: $lastTreeDetail"
$lines += ""
$allPass = -not ($metrics.psobject.Properties | Where-Object { $_.Value.pass -eq $false })
$verdict = if ($allPass) { "OK" } else { "EXCEEDED" }
$lines += "Veredicto: **$verdict**"
$report = $lines -join [Environment]::NewLine
$report | Out-File -FilePath (Join-Path $root "perf-report.md") -Encoding utf8
Write-Output $report

if (-not $allPass) { exit 1 }
exit 0
