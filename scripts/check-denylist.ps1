# Fails if any tracked file contains a term from .github/denylist.txt.
# Two kinds of lines (lines starting with # are comments):
#   sha256:<hex>  a single word, stored hashed so the list never publishes it.
#                 Matched case-insensitively against every word of every tracked text file.
#   anything else a fixed string, matched case-insensitively (for personal absolute paths).
# Usage:
#   powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/check-denylist.ps1
#   powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/check-denylist.ps1 -Hash <word>
#     prints the line to add for <word>; the word itself never goes in the repo.
param([string]$Hash)
$ErrorActionPreference = "Continue"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$sha = [System.Security.Cryptography.SHA256]::Create()
function Get-WordHash([string]$Word) {
    $bytes = $sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($Word.Trim().ToLowerInvariant()))
    return -join ($bytes | ForEach-Object { $_.ToString("x2") })
}
if ($Hash) {
    if ($Hash.Trim() -notmatch '^[\p{L}\p{N}]+$') { Write-Output "denylist: -Hash acepta una sola palabra (letras y numeros)"; exit 1 }
    Write-Output "sha256:$(Get-WordHash $Hash)"
    exit 0
}

$root = (& git rev-parse --show-toplevel).Trim()
if ($LASTEXITCODE -ne 0 -or -not $root) { Write-Output "denylist: no es un repo git"; exit 1 }
$list = Join-Path $root ".github/denylist.txt"
$lines = @(Get-Content $list -Encoding UTF8 | ForEach-Object { $_.Trim() } | Where-Object { $_ -and -not $_.StartsWith("#") })
if ($lines.Count -eq 0) { Write-Output "denylist: lista vacia"; exit 1 }
$hashes = @($lines | Where-Object { $_.StartsWith("sha256:") } | ForEach-Object { $_.Substring(7).ToLowerInvariant() })
$plain = @($lines | Where-Object { -not $_.StartsWith("sha256:") })
$exclude = @(":!.github/denylist.txt", ":!pnpm-lock.yaml", ":!Cargo.lock")

$found = $false
foreach ($term in $plain) {
    $hits = & git -C $root grep -n -i -I -F -e $term -- . @exclude
    if ($LASTEXITCODE -eq 0) {
        $found = $true
        Write-Output "denylist: termino prohibido '$term':"
        $hits | ForEach-Object { Write-Output "  $_" }
    } elseif ($LASTEXITCODE -ne 1) {
        Write-Output "denylist: git grep fallo (exit $LASTEXITCODE)"
        exit 1
    }
}

if ($hashes.Count -gt 0) {
    $wanted = New-Object 'System.Collections.Generic.HashSet[string]'
    $hashes | ForEach-Object { [void]$wanted.Add($_) }
    $seen = New-Object 'System.Collections.Generic.HashSet[string]'
    $text = & git -C $root grep -h -I -e "^" -- . @exclude
    if ($LASTEXITCODE -gt 1) { Write-Output "denylist: git grep fallo (exit $LASTEXITCODE)"; exit 1 }
    foreach ($line in $text) {
        foreach ($m in [regex]::Matches($line, '[\p{L}\p{N}]+')) {
            $word = $m.Value.ToLowerInvariant()
            if (-not $seen.Add($word)) { continue }
            if ($wanted.Contains((Get-WordHash $word))) {
                $found = $true
                Write-Output "denylist: palabra prohibida (sha256 en la lista):"
                & git -C $root grep -n -i -I -w -F -e $word -- . @exclude | ForEach-Object { Write-Output "  $_" }
            }
        }
    }
}

if ($found) { Write-Output "denylist: usa ejemplos neutros (Acme) y rutas con `$env:USERPROFILE"; exit 1 }
Write-Output "denylist: OK"
exit 0
