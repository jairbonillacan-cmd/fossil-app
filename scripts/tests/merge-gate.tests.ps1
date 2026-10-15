# Tests for scripts/merge.ps1 with a fake `gh` (no network, nothing is merged).
# Usage: powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/tests/merge-gate.tests.ps1
$ErrorActionPreference = "Stop"
$gate = Join-Path $PSScriptRoot "..\merge.ps1"
$o = [char]0x00F3  # keeps this file ASCII-only for Windows PowerShell 5.1
$visualHeader = "## Revisi$($o)n visual"
$codeHeader = "## Revisi$($o)n de c$($o)digo"
# PR identity lines (ADR-0016), appended to every body a test overrides.
$identity = "`n**Harness:** ZCode`n**Modelo:** GLM 5.3"

function New-Scenario {
    $pr = [ordered]@{
        number = 1; state = "OPEN"; isDraft = $false; headRefOid = "abc1234def"; baseRefName = "main"
        body = "Closes #7`n`n**Agente:** zcode-a$identity"
        labels = @(); files = @(@{ path = "apps/desktop/src/sidebar.tsx"; additions = 120 })
        comments = @(
            @{ body = "## Presupuestos de rendimiento (perf)`nVeredicto: **OK**"; createdAt = "2026-10-14T09:00:00Z" },
            @{ body = "$visualHeader (antigravity-vision, Gemini 4 Argon)`nVeredicto: OK"; createdAt = "2026-10-14T10:00:00Z" },
            @{ body = "$codeHeader (claude, Opus 5.5)`nVeredicto: OK"; createdAt = "2026-10-14T10:05:00Z" }
        )
    }
    [ordered]@{
        PrView   = @{ Code = 0; Out = $pr }
        Checks   = @{ Code = 0; Out = @(@{ name = "ci"; bucket = "pass" }, @{ name = "perf"; bucket = "pass" }) }
        Compare  = @{ Code = 0; Out = @{ behind_by = 0 } }
        # compare <head>...main: files that landed on main since the PR branched.
        Back     = @{ Code = 0; Out = @{ files = @(@{ filename = "crates/fossil-ai/src/lib.rs" }) } }
        Runs     = @{ Code = 0; Out = @(@{ conclusion = "cancelled"; headSha = "c0" }, @{ conclusion = "success"; headSha = "c1" }) }
        Commits  = @{ Code = 0; Out = @(@{ sha = "abc1234def"; commit = @{ author = @{ date = "2026-10-14T08:00:00Z" } } }) }
        Commit   = @{ Code = 0; Out = @{ files = @(@{ filename = "apps/desktop/src/sidebar.tsx" }) } }
        Merge    = @{ Code = 0; Out = "merged" }
        Files    = @{ Code = 0; Out = '[[{"filename":"apps/desktop/src/sidebar.tsx","sha":"aaa111"},{"filename":"scripts/x.ps1","sha":"bbb222"}]]' }
    }
}

. (Join-Path $PSScriptRoot "..\lib\gate-common.ps1")
$fileLines = @("apps/desktop/src/sidebar.tsx aaa111", "scripts/x.ps1 bbb222")
$huella = Get-PrFingerprint $fileLines
$huellaVisual = Get-PrFingerprint $fileLines -Visual

function global:gh {
    $a = $args -join " "
    $global:GhCalls += , $a
    $s = $global:GateScenario
    $key = switch -Regex ($a) {
        '^repo view' { "Repo" }
        '^pr view \d+ --json number' { "PrView" }
        '^pr view \d+ --json state' { "State" }
        '^pr view \d+ --json closingIssues' { "Closing" }
        '^pr checks' { "Checks" }
        '^api repos/.+/compare/main\.\.\.' { "Compare" }
        '^api repos/.+/compare/.+\.\.\.main$' { "Back" }
        '^run list' { "Runs" }
        '^api --paginate --slurp repos/.+/pulls/\d+/files' { "Files" }
        '^api repos/.+/pulls/\d+/commits' { "Commits" }
        '^api repos/.+/commits/' { "Commit" }
        '^pr merge' { "Merge" }
        default { "Unknown" }
    }
    switch ($key) {
        "Repo" { $global:LASTEXITCODE = 0; return '{"nameWithOwner":"acme/fossil"}' }
        "State" { $global:LASTEXITCODE = 0; return "MERGED" }
        "Closing" { $global:LASTEXITCODE = 0; return "" }
        "Unknown" { $global:LASTEXITCODE = 99; return "UNMOCKED gh $a" }
    }
    $r = $s[$key]
    $global:LASTEXITCODE = $r.Code
    if ($r.Out -is [string]) { return $r.Out }
    return (ConvertTo-Json -InputObject $r.Out -Depth 10 -Compress)
}

$script:failures = 0
function Test-Gate([string]$Name, [scriptblock]$Arrange, [bool]$ExpectMerge, [string]$ExpectText) {
    $global:GateScenario = New-Scenario
    $global:GhCalls = @()
    & $Arrange $global:GateScenario
    $out = (& $gate -Pr 1 2>&1) | Out-String
    $code = $LASTEXITCODE
    $merged = @($global:GhCalls | Where-Object { $_ -like "pr merge*" }).Count -gt 0
    $ok = ($merged -eq $ExpectMerge) -and (($code -eq 0) -eq $ExpectMerge) -and ($out -match $ExpectText)
    if ($ok) { Write-Output "ok   - $Name" }
    else {
        $script:failures++
        Write-Output "FAIL - $Name (exit=$code merged=$merged)`n$out"
    }
}

$pr = { param($s) $s.PrView.Out }

Test-Gate "valid PR is merged with --match-head-commit" { } $true "mergeado"
Test-Gate "merge pins the reviewed head" { } $true "OK \(CI verde"
if (-not (@($global:GhCalls | Where-Object { $_ -like "pr merge*--match-head-commit abc1234def*" }).Count)) { $script:failures++; Write-Output "FAIL - merge without --match-head-commit" }

# Issue #59, case A: a code review must never count as the visual verdict.
Test-Gate "#59 A: codex code review is not a visual OK" {
    param($s) (& $pr $s).comments = @(@{ body = "$codeHeader (codex, GPT 6.1 Sol)`nVeredicto: OK"; createdAt = "2026-10-14T10:00:00Z" })
} $false "no tiene revision visual"
# Issue #59, case B: an API error must reject, not look like "no visual files".
Test-Gate "#59 B: pr view failing rejects" { param($s) $s.PrView = @{ Code = 1; Out = "" } } $false "fallo \(exit 1\)"
Test-Gate "pr view with empty output rejects" { param($s) $s.PrView = @{ Code = 0; Out = " " } } $false "respuesta vacia"
Test-Gate "pr view with invalid JSON rejects" { param($s) $s.PrView = @{ Code = 0; Out = "{nope" } } $false "JSON invalido"
Test-Gate "pr view missing files field rejects" { param($s) (& $pr $s).Remove("files") } $false "falta el campo 'files'"
Test-Gate "perf comment is not a visual OK" { param($s) (& $pr $s).comments = @((& $pr $s).comments[0], (& $pr $s).comments[2]) } $false "no tiene revision visual"
Test-Gate "latest visual CAMBIOS wins over older OK" {
    param($s) (& $pr $s).comments += @{ body = "$visualHeader (antigravity-vision, Gemini 4 Argon)`nVeredicto: CAMBIOS"; createdAt = "2026-10-14T11:00:00Z" }
} $false "no es OK: CAMBIOS"
# The gate keys reviewers by agent id, not by model: a smaller model in the
# same role (e.g. Gemini 3.8 Flash away from the office) still counts.
Test-Gate "visual OK from the same role on another model counts" {
    param($s) (& $pr $s).comments += @(
        @{ body = "$visualHeader (antigravity-vision, Gemini 4 Argon)`nVeredicto: CAMBIOS"; createdAt = "2026-10-14T11:00:00Z" },
        @{ body = "$visualHeader (antigravity-vision, Gemini 3.8 Flash)`nVeredicto: OK"; createdAt = "2026-10-14T12:00:00Z" })
} $true "mergeado"
Test-Gate "visual OK from a non-vision agent does not count" {
    param($s) (& $pr $s).comments += @(
        @{ body = "$visualHeader (antigravity-vision, Gemini 4 Argon)`nVeredicto: CAMBIOS"; createdAt = "2026-10-14T11:00:00Z" },
        @{ body = "$visualHeader (claude, Opus 5.5)`nVeredicto: OK"; createdAt = "2026-10-14T12:00:00Z" })
} $false "no es OK: CAMBIOS"
Test-Gate "visual commit authored after the OK rejects" {
    param($s) $s.Commits.Out += @{ sha = "fff9999aaa"; commit = @{ author = @{ date = "2026-10-14T10:02:00Z" } } }
} $false "posteriores al OK"
Test-Gate "commit authored after the code review rejects" {
    param($s) $s.Commits.Out += @{ sha = "eee8888bbb"; commit = @{ author = @{ date = "2026-10-14T12:00:00Z" } } }
} $false "despues de la revision de codigo"
Test-Gate "author cannot approve their own PR" {
    param($s) (& $pr $s).body = "Closes #7`n**Agente:** claude$identity"; (& $pr $s).files = @(@{ path = "scripts/merge.ps1"; additions = 5 })
} $false "agente distinto al autor \(claude\)"
Test-Gate "missing Agente line rejects" { param($s) (& $pr $s).body = "Closes #7" } $false "Agente"
Test-Gate "missing Harness line rejects" { param($s) (& $pr $s).body = "Closes #7`n**Agente:** zcode-a`n**Modelo:** GLM 5.3" } $false "Harness:"
Test-Gate "missing Modelo line rejects" { param($s) (& $pr $s).body = "Closes #7`n**Agente:** zcode-a`n**Harness:** ZCode" } $false "Modelo:"
Test-Gate "template placeholder is not an identity" {
    param($s) (& $pr $s).body = "Closes #7`n**Agente:** zcode-a`n**Harness:** <!-- herramienta -->`n**Modelo:** GLM 5.3"
} $false "Harness:"
Test-Gate "claude-vision is an accepted visual reviewer" {
    param($s) (& $pr $s).comments += @{ body = "$visualHeader (claude-vision, Claude Code, Opus 5.5)`nVeredicto: OK"; createdAt = "2026-10-15T10:00:00Z" }
} $true "revision visual aprobada \(claude-vision"
Test-Gate "a visual review from an agent outside the vision list does not count" {
    param($s) (& $pr $s).comments = @(
        @{ body = "$codeHeader (claude, Opus 5.5)`nVeredicto: OK"; createdAt = "2026-10-14T10:05:00Z" },
        @{ body = "$visualHeader (claude-review, Claude Code, Opus 5.5)`nVeredicto: OK"; createdAt = "2026-10-15T10:00:00Z" })
} $false "visual"
Test-Gate "OK names author and reviewers with harness and model" {
    param($s) (& $pr $s).comments += @(
        @{ body = "$visualHeader (antigravity-vision, Antigravity, Gemini 3.8 Flash)`nVeredicto: OK"; createdAt = "2026-10-15T10:00:00Z" },
        @{ body = "$codeHeader (claude, Claude Code, Opus 5.5)`nVeredicto: OK"; createdAt = "2026-10-15T10:05:00Z" })
} $true "autor zcode-a \(ZCode, GLM 5\.3\); codigo revisado por claude \(Claude Code, Opus 5\.5\); revision visual aprobada \(antigravity-vision \(Antigravity, Gemini 3\.8 Flash\)\)"
Test-Gate "new review without harness rejects instead of being skipped" {
    param($s) (& $pr $s).comments += @{ body = "$codeHeader (claude, Opus 5.5)`nVeredicto: CAMBIOS"; createdAt = "2026-10-15T11:00:00Z" }
} $false "no identifica harness y modelo"
Test-Gate "legacy review before the cutoff still counts" { } $true "codigo revisado por claude \(Opus 5\.5\)"
Test-Gate "missing Closes/Parte de rejects" { param($s) (& $pr $s).body = "**Agente:** zcode-a$identity" } $false "Parte de #n"
Test-Gate "draft rejects" { param($s) (& $pr $s).isDraft = $true } $false "draft"
Test-Gate "needs:vision label rejects" { param($s) (& $pr $s).labels = @(@{ name = "needs:vision" }) } $false "needs:vision"
Test-Gate "missing ci check rejects" { param($s) $s.Checks.Out = @(@{ name = "perf"; bucket = "pass" }) } $false "falta el check 'ci'"
Test-Gate "red check rejects" { param($s) $s.Checks.Out = @(@{ name = "ci"; bucket = "fail" }) } $false "checks no verdes"
Test-Gate "pending checks (exit 8) reject" { param($s) $s.Checks.Code = 8 } $false "exit 8"
# Behind main: allowed only when main's new commits touch none of the PR's
# files and no shared file (PO decision).
Test-Gate "PR behind main without overlap merges" { param($s) $s.Compare.Out = @{ behind_by = 2 } } $true "2 commit\(s\) detras de main sin solape"
Test-Gate "PR behind main touching the same file rejects" {
    param($s) $s.Compare.Out = @{ behind_by = 2 }; $s.Back.Out = @{ files = @(@{ filename = "apps/desktop/src/sidebar.tsx" }) }
} $false "cambio archivos del PR \(apps/desktop/src/sidebar.tsx\)"
Test-Gate "PR behind main with a shared file change rejects" {
    param($s) $s.Compare.Out = @{ behind_by = 1 }; $s.Back.Out = @{ files = @(@{ filename = "Cargo.lock" }) }
} $false "archivos compartidos \(Cargo.lock\)"
Test-Gate "PR behind main with a new migration rejects" {
    param($s) $s.Compare.Out = @{ behind_by = 1 }; $s.Back.Out = @{ files = @(@{ filename = "crates/fossil-core/migrations/0003_x.sql" }) }
} $false "archivos compartidos"
Test-Gate "PR behind main without the file list rejects" {
    param($s) $s.Compare.Out = @{ behind_by = 1 }; $s.Back.Out = @{ status = "diverged" }
} $false "falta la lista de archivos"
Test-Gate "PR far behind main (300+ files) rejects" {
    param($s) $s.Compare.Out = @{ behind_by = 40 }; $s.Back.Out = @{ files = @(1..300 | ForEach-Object { @{ filename = "docs/f$_.md" } }) }
} $false "demasiados cambios"
Test-Gate "PR behind main on a red main still freezes" {
    param($s) $s.Compare.Out = @{ behind_by = 2 }; $s.Runs.Out = @(@{ conclusion = "failure"; headSha = "c9" })
} $false "en rojo"
Test-Gate "compare API error rejects" { param($s) $s.Compare = @{ Code = 1; Out = "HTTP 500" } } $false "fallo"
Test-Gate "red main freezes merges" { param($s) $s.Runs.Out = @(@{ conclusion = "failure"; headSha = "c9" }) } $false "en rojo"
Test-Gate "fix:main may merge while main is red" {
    param($s) $s.Runs.Out = @(@{ conclusion = "failure"; headSha = "c9" }); (& $pr $s).labels = @(@{ name = "fix:main" })
} $true "mergeado"
Test-Gate "non-visual PR needs no visual review" {
    param($s) (& $pr $s).files = @(@{ path = "docs/modules/ui.md"; additions = 3 }); (& $pr $s).comments = @((& $pr $s).comments[2])
} $true "no requerida"
Test-Gate "bindings.ts alone is not visual" {
    param($s) (& $pr $s).files = @(@{ path = "apps/desktop/src/bindings.ts"; additions = 900 }); (& $pr $s).comments = @((& $pr $s).comments[2])
} $true "no requerida"
Test-Gate "test files are not visual" {
    param($s) (& $pr $s).files = @(@{ path = "apps/desktop/src/sidebar.test.tsx"; additions = 40 }); (& $pr $s).comments = @((& $pr $s).comments[2])
} $true "no requerida"
# Lanes (.github/lanes.json): zcode-a owns the shell lane.
Test-Gate "hot file without cross-lane rejects" {
    param($s) (& $pr $s).files += @{ path = "apps/desktop/src/app.tsx"; additions = 2 }
} $false "sin el label cross-lane: apps/desktop/src/app.tsx"
Test-Gate "hot file with cross-lane merges" {
    param($s) (& $pr $s).files += @{ path = "apps/desktop/src/app.tsx"; additions = 2 }; (& $pr $s).labels = @(@{ name = "cross-lane" })
} $true "mergeado"
Test-Gate "file of another lane rejects" {
    param($s) (& $pr $s).files += @{ path = "crates/fossil-core/src/vault.rs"; additions = 5 }
} $false "fuera del carril de zcode-a"
Test-Gate "unknown agent has no lane" { param($s) (& $pr $s).body = "Closes #7`n**Agente:** nadie$identity" } $false "fuera del carril de nadie"
# Size: at most 400 added lines, generated files excluded.
Test-Gate "more than 400 added lines rejects" { param($s) (& $pr $s).files[0].additions = 401 } $false "agrega 401 lineas"
Test-Gate "generated files do not count toward the limit" {
    param($s) (& $pr $s).files += @{ path = "pnpm-lock.yaml"; additions = 5000 }
} $true "mergeado"
Test-Gate "missing additions rejects" { param($s) (& $pr $s).files[0].Remove("additions") } $false "falta additions"

# Fingerprints (Huella): valid while the reviewed content is unchanged, even
# with commits authored after the review; a stale one always rejects.
$lateCommit = @{ sha = "fff9999aaa"; commit = @{ author = @{ date = "2026-10-14T12:00:00Z" } } }
Test-Gate "code review with current Huella accepts later commits" {
    param($s)
    (& $pr $s).comments[2].body += "`nHuella: $huella"
    (& $pr $s).comments[1].body += "`nHuella visual: $huellaVisual"
    $s.Commits.Out += $lateCommit
} $true "mergeado"
Test-Gate "stale code Huella rejects" {
    param($s) (& $pr $s).comments[2].body += "`nHuella: 0123456789abcdef"
} $false "huella de la revision de codigo no coincide"
Test-Gate "stale visual Huella rejects" {
    param($s) (& $pr $s).comments[1].body += "`nHuella visual: 0123456789abcdef"
} $false "huella visual no coincide"
Test-Gate "files API error with a Huella rejects" {
    param($s) (& $pr $s).comments[2].body += "`nHuella: $huella"; $s.Files = @{ Code = 1; Out = "" }
} $false "fallo"
if ($huella -eq $huellaVisual) { $script:failures++; Write-Output "FAIL - visual fingerprint must ignore non-visual files" }
if ((Get-PrFingerprint @("b 2", "a 1")) -ne (Get-PrFingerprint @("a 1", "b 2"))) { $script:failures++; Write-Output "FAIL - fingerprint must not depend on order" }

Remove-Item Function:\gh
if ($script:failures -gt 0) { Write-Output "$script:failures test(s) fallaron"; exit 1 }
Write-Output "merge-gate: todos los tests pasan"
exit 0
