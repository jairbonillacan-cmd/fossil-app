# Fails if CHANGELOG.md breaks the "in main / published" separation (#79).
#   1. "## Sin publicar" (if present) comes first, above every version.
#   2. Every other section is "## <version> · <AAAA-MM-DD>".
#   3. A version with a git tag v<version> must match, line by line, the section of
#      CHANGELOG.md inside that tag: a published version cannot mention anything
#      that is not in its tag. Versions without a tag yet are still being prepared.
# Usage:
#   powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/check-release-trace.ps1 [-Root <repo>]
param([string]$Root)
$ErrorActionPreference = "Continue"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
if (-not $Root) { $Root = (& git rev-parse --show-toplevel).Trim() }

function Get-Sections([string[]]$Lines) {
    $sections = [ordered]@{}
    $current = $null
    foreach ($line in $Lines) {
        if ($line -match '^## (.+?)\s*$') {
            $current = $Matches[1]
            $sections[$current] = New-Object System.Collections.Generic.List[string]
        } elseif ($null -ne $current) {
            $sections[$current].Add($line.TrimEnd())
        }
    }
    return $sections
}
function Get-Body($List) { return ((@($List) -join "`n").Trim()) }

$path = Join-Path $Root "CHANGELOG.md"
if (-not (Test-Path $path)) { Write-Output "release-trace: no hay CHANGELOG.md en $Root"; exit 1 }
$sections = Get-Sections @(Get-Content $path -Encoding UTF8)
$errors = @()
$dot = [string][char]0x00B7  # middle dot; kept out of the source so Windows PowerShell 5.1 reads the file correctly
$keys = @($sections.Keys)

for ($i = 0; $i -lt $keys.Count; $i++) {
    $k = $keys[$i]
    if ($k -eq "Sin publicar") {
        if ($i -ne 0) { $errors += "'Sin publicar' debe ser la primera seccion, arriba de las versiones." }
    } elseif ($k -notmatch ("^(\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?) $dot (\d{4}-\d{2}-\d{2})`$")) {
        $errors += "Encabezado invalido '## $k': usa '## <version> $dot <AAAA-MM-DD>' o '## Sin publicar'."
    }
}

foreach ($k in $keys) {
    if ($k -notmatch ("^(\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?) $dot ")) { continue }
    $tag = "v$($Matches[1])"
    & git -C $Root rev-parse --verify --quiet "refs/tags/$tag" 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) { Write-Output "skip - $k (sin etiqueta ${tag}: version en preparacion)"; continue }
    $tagged = @(& git -C $Root show "${tag}:CHANGELOG.md" 2>$null)
    if ($LASTEXITCODE -ne 0) { $errors += "${tag} no tiene CHANGELOG.md; '## $k' menciona algo que no esta en su etiqueta."; continue }
    $tagSections = Get-Sections $tagged
    if (-not $tagSections.Contains($k)) { $errors += "La seccion '## $k' no existe en CHANGELOG.md de ${tag}."; continue }
    if ((Get-Body $sections[$k]) -ne (Get-Body $tagSections[$k])) {
        $errors += "La seccion '## $k' difiere de la que esta en ${tag}: una version publicada no se edita (publica un parche)."
    } else {
        Write-Output "ok   - $k coincide con $tag"
    }
}

if ($errors.Count -gt 0) {
    $errors | ForEach-Object { Write-Output "FAIL - $_" }
    exit 1
}
Write-Output "release-trace: ok"
exit 0
