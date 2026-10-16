# Shared perf statistics, dot-sourced by scripts/perf.ps1 and tested by
# scripts/tests/perf.tests.ps1 (#78). Compatible with PowerShell 5.1 and 7.

# Nearest-rank percentile of a numeric series: sort ascending and take the
# element at rank ceil(p/100 * n) (1-based, clamped). [1..100] gives
# p50 = 50 and p95 = 95; a single value is always its own percentile;
# an empty series yields $null so callers can report "not measured".
function Get-Percentile([double[]]$Values, [double]$Percentile) {
    if ($null -eq $Values -or $Values.Count -eq 0) { return $null }
    $sorted = $Values | Sort-Object
    $rank = [math]::Ceiling($Percentile / 100.0 * $sorted.Count)
    if ($rank -lt 1) { $rank = 1 }
    if ($rank -gt $sorted.Count) { $rank = $sorted.Count }
    return [double]$sorted[$rank - 1]
}
