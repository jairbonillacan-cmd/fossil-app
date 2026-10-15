# Prints the review fingerprint of a PR for the "Huella:" / "Huella visual:"
# line of a review comment (ADR-0012). The merge gate recomputes it.
# Usage: powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/pr-fingerprint.ps1 <pr> [-Visual]
param(
    [Parameter(Mandatory = $true)]
    [int]$Pr,
    [switch]$Visual
)

$ErrorActionPreference = "Continue"
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }
. (Join-Path $PSScriptRoot "lib/gate-common.ps1")
$repo = (& gh repo view --json nameWithOwner --jq ".nameWithOwner")
if ($LASTEXITCODE -ne 0 -or -not $repo) { Write-Output "pr-fingerprint: no se pudo resolver el repo"; exit 1 }
# --slurp: one JSON array of pages, same call as the merge gate. (No --jq with
# quotes: Windows PowerShell 5.1 splits native arguments that contain them.)
$raw = (& gh api --paginate --slurp "repos/$repo/pulls/$Pr/files?per_page=100") | Out-String
if ($LASTEXITCODE -ne 0) { Write-Output "pr-fingerprint: no se pudieron leer los archivos del PR #$Pr"; exit 1 }
$lines = @(($raw | ConvertFrom-Json) | ForEach-Object { $_ } | ForEach-Object { "$($_.filename) $($_.sha)" })
if ($lines.Count -eq 0) { Write-Output "pr-fingerprint: el PR #$Pr no tiene archivos"; exit 1 }
Write-Output (Get-PrFingerprint $lines -Visual:$Visual)
exit 0
