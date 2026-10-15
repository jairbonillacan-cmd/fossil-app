# Shared by scripts/merge.ps1 and scripts/pr-fingerprint.ps1 (ADR-0012).

# Visual files: apps/desktop/src/**, packages/ui/**, docs/screenshots/**, *.css
# except apps/desktop/src/bindings.ts (tauri-specta codegen, drift-checked)
# and tests (*.test.ts, *.test.tsx), which never render in the app.
function Test-VisualPath([string]$Path) {
    if ($Path -eq "apps/desktop/src/bindings.ts") { return $false }
    if ($Path -like "*.test.ts" -or $Path -like "*.test.tsx") { return $false }
    return ($Path -like "apps/desktop/src/*" -or $Path -like "packages/ui/*" -or
        $Path -like "docs/screenshots/*" -or $Path -like "*.css")
}

# Review fingerprint: first 16 hex chars of sha256 over the sorted
# "<path> <blob sha>" lines of the PR files (only visual ones with -Visual).
# A clean rebase keeps every blob, so it keeps the fingerprint; any real change
# to a reviewed file changes it.
function Get-PrFingerprint([string[]]$FileLines, [switch]$Visual) {
    $lines = @($FileLines | Where-Object { $_ -and $_.Trim() } | ForEach-Object { $_.Trim() })
    if ($Visual) { $lines = @($lines | Where-Object { Test-VisualPath (($_ -split " ", 2)[0]) }) }
    $text = (@($lines | Sort-Object -CaseSensitive) -join "`n")
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        $bytes = $sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($text))
    } finally {
        $sha.Dispose()
    }
    return (-join ($bytes | ForEach-Object { $_.ToString("x2") })).Substring(0, 16)
}
