# Regression tests for scripts/perf.ps1 path resolution (#109).
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

if ($failures -gt 0) {
    Write-Output "$failures test(s) failed"
    exit 1
}
Write-Output "perf.tests: all tests passed"
exit 0
