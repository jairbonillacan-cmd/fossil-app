# Regression tests for scripts/perf.ps1 path resolution (#109) and for the
# percentile function used by the perf report (#78).
# Usage: powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/tests/perf.tests.ps1
$ErrorActionPreference = "Stop"
$perf = Join-Path $PSScriptRoot "..\perf.ps1"
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$failures = 0

function Assert-True([string]$Name, [bool]$Condition, [string]$Detail) {
    if ($Condition) {
        Write-Output "ok   - $Name"
    } else {
        $script:failures++
        Write-Output "FAIL - $Name`n$Detail"
    }
}

$savedTargetDir = $env:CARGO_TARGET_DIR
try {
    # 1) When CARGO_TARGET_DIR is unset/empty, default to <repo>\target
    $env:CARGO_TARGET_DIR = ""
    $outDefault = (& $perf -PrintPathsOnly 2>&1) | Out-String
    $expectedDefaultNsis = Join-Path (Join-Path $root "target") "release\bundle\nsis"
    $expectedDefaultExe = Join-Path (Join-Path $root "target") "release\fossil-desktop.exe"
    Assert-True "default target dir when CARGO_TARGET_DIR is empty" (
        ($LASTEXITCODE -eq 0) -and
        $outDefault.Contains("nsisDir=$expectedDefaultNsis") -and
        $outDefault.Contains("exe=$expectedDefaultExe")
    ) $outDefault

    # 2) When CARGO_TARGET_DIR is set (e.g. a shared target dir), resolve under CARGO_TARGET_DIR
    $customTarget = Join-Path $env:TEMP "fossil-perf-test-target"
    $env:CARGO_TARGET_DIR = $customTarget
    $outCustom = (& $perf -PrintPathsOnly 2>&1) | Out-String
    $expectedCustomNsis = Join-Path $customTarget "release\bundle\nsis"
    $expectedCustomExe = Join-Path $customTarget "release\fossil-desktop.exe"
    Assert-True "custom CARGO_TARGET_DIR resolves nsisDir and exe" (
        ($LASTEXITCODE -eq 0) -and
        $outCustom.Contains("nsisDir=$expectedCustomNsis") -and
        $outCustom.Contains("exe=$expectedCustomExe")
    ) $outCustom
} finally {
    $env:CARGO_TARGET_DIR = $savedTargetDir
}

# --- 3) Get-Percentile (#78): known cases on the single shared definition ------
. (Join-Path $PSScriptRoot "..\lib\perf-stats.ps1")

$oneToHundred = [double[]](1..100)
$empty = [double[]]@()
$single = [double[]]@([double]7)
$unsorted = [double[]]@(3, 1, 2)
Assert-True "p50 of 1..100 is 50" ((Get-Percentile $oneToHundred 50) -eq 50) (
    "got $(Get-Percentile $oneToHundred 50)")
Assert-True "p95 of 1..100 is 95" ((Get-Percentile $oneToHundred 95) -eq 95) (
    "got $(Get-Percentile $oneToHundred 95)")
Assert-True "empty series yields null" ($null -eq (Get-Percentile $empty 50)) "expected null"
Assert-True "single value is its own percentile" ((Get-Percentile $single 95) -eq 7) (
    "got $(Get-Percentile $single 95)")
Assert-True "unsorted input is sorted first" ((Get-Percentile $unsorted 50) -eq 2) (
    "got $(Get-Percentile $unsorted 50)")
Assert-True "percentile above 100 clamps to the max" ((Get-Percentile $oneToHundred 150) -eq 100) (
    "got $(Get-Percentile $oneToHundred 150)")

# --- 4) scripts/perf.ps1 must keep its UTF-8 BOM for Windows PowerShell 5.1 ---
$perfBytes = [System.IO.File]::ReadAllBytes($perf)
$hasBom = ($perfBytes.Length -ge 3) -and ($perfBytes[0] -eq 0xEF) -and ($perfBytes[1] -eq 0xBB) -and ($perfBytes[2] -eq 0xBF)
Assert-True "scripts/perf.ps1 starts with UTF-8 BOM (0xEF,0xBB,0xBF)" $hasBom (
    "first bytes: $($perfBytes[0..2] -join ',')")

if ($failures -gt 0) {
    Write-Output "$failures test(s) failed"
    exit 1
}
Write-Output "perf.tests: all tests passed"
exit 0
