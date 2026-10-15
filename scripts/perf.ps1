# Fossil performance budgets (docs/DOD.md §Rendimiento).
# Measures: installer size, time to visible window, RAM of the process tree
# (including msedgewebview2 children). Writes perf-report.md and exits 1 if
# any budget is exceeded. Compatible with PowerShell 5.1 and 7.
param(
    [double]$MaxInstallerMB = 30,
    [double]$MaxStartupSeconds = 1.5,
    [double]$MaxRamMB = 200,
    [switch]$PrintPathsOnly
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

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

$results = @()

function Add-Result([string]$Name, [double]$Value, [string]$Unit, [double]$Budget, [bool]$Pass) {
    $script:results += [pscustomobject]@{
        Name = $Name; Value = $Value; Unit = $Unit; Budget = $Budget; Pass = $Pass
    }
}

# --- 1) Installer size -------------------------------------------------------
$installer = Get-ChildItem -Path $nsisDir -Filter "*.exe" -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
if ($null -eq $installer) {
    Write-Error "No NSIS installer found under $nsisDir. Run 'pnpm.cmd build' first."
}
$installerMB = [math]::Round($installer.Length / 1MB, 2)
Add-Result "Installer size ($($installer.Name))" $installerMB "MB" $MaxInstallerMB ($installerMB -lt $MaxInstallerMB)

# --- 2) Time to visible window ------------------------------------------------
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
Get-Process fossil-desktop -ErrorAction SilentlyContinue |
    Where-Object { $_.Path -eq $exe } |
    Stop-Process -Force
Start-Sleep -Milliseconds 500

# Warm up JIT and P/Invoke marshaling before starting the stopwatch.
[FossilWinEnum]::HasVisibleWindow(0, "Fossil") | Out-Null

$sw = [System.Diagnostics.Stopwatch]::StartNew()
$proc = Start-Process -FilePath $exe -PassThru
$target = [uint32]$proc.Id
$visible = $false
while ($sw.ElapsedMilliseconds -lt 30000) {
    if ([FossilWinEnum]::HasVisibleWindow($target, "Fossil")) {
        $visible = $true
        break
    }
    Start-Sleep -Milliseconds 15
}
$sw.Stop()
if (-not $visible) {
    Write-Error "Fossil window did not become visible within 30 s."
}
$startupSeconds = [math]::Round($sw.Elapsed.TotalSeconds, 2)
Add-Result "Cold start to visible window" $startupSeconds "s" $MaxStartupSeconds ($startupSeconds -lt $MaxStartupSeconds)

# --- 3) RAM of the process tree ------------------------------------------------
Start-Sleep -Seconds 3   # let the webview settle
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
$treeIds = @([int]$proc.Id) + (Get-DescendantIds $proc.Id)
$ramMB = 0.0
$treeDetail = @()
foreach ($id in $treeIds) {
    $p = Get-Process -Id $id -ErrorAction SilentlyContinue
    if ($null -ne $p) {
        $mb = [math]::Round($p.PrivateMemorySize64 / 1MB, 1)
        $ramMB += $mb
        $treeDetail += "$($p.Name): $mb MB"
    }
}
$ramMB = [math]::Round($ramMB, 1)
Add-Result "RAM at rest (private commit, process tree, $($treeIds.Count) processes)" $ramMB "MB" $MaxRamMB ($ramMB -lt $MaxRamMB)

Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
Get-Process fossil-desktop -ErrorAction SilentlyContinue |
    Where-Object { $_.Path -eq $exe } |
    Stop-Process -Force

# --- Report ---------------------------------------------------------------------
$allPass = -not ($results | Where-Object { -not $_.Pass })
$verdict = if ($allPass) { "OK" } else { "EXCEEDED" }

$lines = @()
$lines += "## Presupuestos de rendimiento (perf)"
$lines += ""
$lines += "| Métrica | Valor | Presupuesto | Estado |"
$lines += "|---|---|---|---|"
foreach ($r in $results) {
    $mark = if ($r.Pass) { "OK" } else { "**FUERA**" }
    $lines += "| $($r.Name) | $($r.Value) $($r.Unit) | < $($r.Budget) $($r.Unit) | $mark |"
}
$lines += ""
$lines += "Detalle del árbol de procesos: $($treeDetail -join ' · ')"
$lines += ""
$lines += "Veredicto: **$verdict**"
$report = $lines -join [Environment]::NewLine
$report | Out-File -FilePath (Join-Path $root "perf-report.md") -Encoding utf8
Write-Output $report

if (-not $allPass) { exit 1 }
exit 0
