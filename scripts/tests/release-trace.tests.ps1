# Tests for scripts/check-release-trace.ps1 (#79), using a throwaway git repo.
# Usage: powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/tests/release-trace.tests.ps1
$ErrorActionPreference = "Stop"
$check = Join-Path $PSScriptRoot "..\check-release-trace.ps1"
$failures = 0
function Assert-True([string]$Name, [bool]$Condition, [string]$Detail) {
    if ($Condition) { Write-Output "ok   - $Name" } else { $script:failures++; Write-Output "FAIL - $Name`n$Detail" }
}
function Invoke-Repo([string[]]$GitArgs) { & git -C $repo -c user.name=t -c user.email=t@example.com @GitArgs | Out-Null }
function Run() { $o = (& powershell -NoProfile -ExecutionPolicy Bypass -File $check -Root $repo 2>&1 | Out-String); return @{ Code = $LASTEXITCODE; Out = $o } }
function Write-Log([string]$Text) { [System.IO.File]::WriteAllText((Join-Path $repo "CHANGELOG.md"), $Text, (New-Object System.Text.UTF8Encoding($false))) }

$repo = Join-Path $env:TEMP ("fossil-release-trace-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $repo | Out-Null
try {
    & git -C $repo init -q
    $dot = [string][char]0x00B7
    $v1 = "## 0.1.0-alpha.1 $dot 2026-10-14`n`n### Novedades`n- Espacios.`n"
    $unreleased = "# Changelog`n`n## Sin publicar`n`n### Novedades`n- Busqueda.`n`n"

    Write-Log ($unreleased + $v1)
    Invoke-Repo @("add", "."); Invoke-Repo @("commit", "-q", "-m", "one")
    $r = Run
    Assert-True "untagged version and Sin publicar pass" ($r.Code -eq 0) $r.Out

    Invoke-Repo @("tag", "v0.1.0-alpha.1")
    $r = Run
    Assert-True "tagged version identical to its tag passes" ($r.Code -eq 0) $r.Out

    Write-Log ($unreleased + $v1 + "- Algo nuevo.`n")
    $r = Run
    Assert-True "published version edited after its tag fails" ($r.Code -ne 0 -and $r.Out.Contains("difiere")) $r.Out

    Write-Log ($v1 + "`n## Sin publicar`n- X.`n")
    $r = Run
    Assert-True "Sin publicar below a version fails" ($r.Code -ne 0 -and $r.Out.Contains("primera seccion")) $r.Out

    Write-Log ($unreleased + "## 0.2.0`n- Y.`n")
    $r = Run
    Assert-True "heading without date fails" ($r.Code -ne 0 -and $r.Out.Contains("Encabezado invalido")) $r.Out
} finally {
    Remove-Item -Recurse -Force $repo -ErrorAction SilentlyContinue
}
if ($failures -gt 0) { Write-Output "$failures test(s) failed"; exit 1 }
Write-Output "all tests passed"
