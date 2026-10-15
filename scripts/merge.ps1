# Fossil merge gate (ADR-0012). Only the orchestrator (claude) runs it.
# Fails CLOSED: any gh error, empty or invalid answer rejects the merge.
# Squash-merges a PR only when ALL of these hold:
#   1. the PR is open, not a draft, and its body has "**Agente:** <id>",
#      "**Harness:** <tool>", "**Modelo:** <model>" (ADR-0016) and
#      "Closes #n" / "Parte de #n";
#   2. the CI check named "ci" passed and every other check passed or skipped;
#   3. the PR is up to date with its base (compare behind_by == 0) OR, when it
#      is behind, the commits that landed on the base since the PR branched
#      touch none of the PR's files and no shared file (lockfiles, manifests,
#      bindings.ts, lib.rs, migrations, workflows); a broken combination is
#      then caught by main's CI and the freeze in rule 4 (PO decision);
#   4. the latest completed ci.yml run on the base branch is green, unless the
#      PR carries the label fix:main (the fix for a red main);
#   5. the latest code review "## Revision de codigo (<agent>" written by an
#      agent other than the PR author says "Veredicto: OK", and no commit was
#      AUTHORED after it;
#   6. the PR has no needs:vision label and, if it changes visual files, the
#      latest "## Revision visual (antigravity-vision|zcode-vision|claude-vision" says
#      "Veredicto: OK" and no commit AUTHORED after it touches visual files;
#   7. every file is inside the lane of the PR author (.github/lanes.json) and
#      none is a hot file, unless the orchestrator added the label cross-lane;
#   8. the PR adds at most 400 lines, not counting generated files.
# Review headers posted since $IdentitySince must name agent, harness and
# model: "## Revision ... (<agent>, <harness>, <model>)" (ADR-0016). A newer
# review with an incomplete header rejects the merge instead of being skipped,
# so a malformed CAMBIOS can never let an older OK through.
# Rebased commits keep their author date, so a rebase never invalidates a
# review. Comments are identified by their header because every agent posts
# from the same GitHub account.
# Visual files: apps/desktop/src/**, packages/ui/**, docs/screenshots/**, *.css
# except apps/desktop/src/bindings.ts (tauri-specta codegen, drift-checked)
# and tests (*.test.ts, *.test.tsx), which never render in the app.
# On success it removes status:* labels from the closing issue(s).
# Usage: powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/merge.ps1 <pr> [-DryRun]
param(
    [Parameter(Mandatory = $true)]
    [int]$Pr,
    [switch]$DryRun
)

$ErrorActionPreference = "Continue"
# gh prints UTF-8; Windows PowerShell would otherwise decode it with the OEM
# code page and mangle the accented review headers.
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

$VisionAgents = @("antigravity-vision", "zcode-vision", "claude-vision")
$HeaderRegex = '^\s*##\s+Revisi\S{1,2}n\s+(?<kind>visual|de\s+c\S{1,2}digo)\s*\(\s*(?<agent>[a-z0-9][a-z0-9-]*)(?<rest>[^)\r\n]*)'
# Reviews from this moment on must carry harness and model (ADR-0016); older
# ones keep the legacy "(<agent>, <model>)" header.
$IdentitySince = [DateTimeOffset]::Parse("2026-10-15T00:00:00Z", [Globalization.CultureInfo]::InvariantCulture)

# Fail throws so the reason survives even when raised inside a function whose
# output is being captured; any other terminating error also rejects.
trap {
    Write-Output "merge-gate: RECHAZADO - $($_.Exception.Message)"
    exit 1
}

function Fail([string]$Message) {
    throw $Message
}

function Invoke-Gh([string[]]$GhArgs) {
    $out = (& gh @GhArgs 2>&1) | Out-String
    if ($LASTEXITCODE -ne 0) {
        Fail ("'gh {0}' fallo (exit {1}): {2}" -f ($GhArgs -join " "), $LASTEXITCODE, $out.Trim())
    }
    return $out
}

function Get-GhJson([string[]]$GhArgs, [string]$What) {
    $raw = Invoke-Gh $GhArgs
    if ([string]::IsNullOrWhiteSpace($raw)) { Fail "$What`: respuesta vacia de gh" }
    try { $obj = $raw | ConvertFrom-Json } catch { Fail "$What`: JSON invalido de gh" }
    if ($null -eq $obj) { Fail "$What`: respuesta nula de gh" }
    return $obj
}

function Assert-Fields($Obj, [string[]]$Names, [string]$What) {
    $present = @($Obj.PSObject.Properties | ForEach-Object { $_.Name })
    foreach ($n in $Names) {
        if ($present -notcontains $n) { Fail "$What`: falta el campo '$n'" }
    }
}

function ConvertTo-Date($Value) {
    if ($Value -is [datetime]) { return [DateTimeOffset]$Value }
    return [DateTimeOffset]::Parse([string]$Value, [Globalization.CultureInfo]::InvariantCulture)
}

# Files several PRs change together or that change the whole build: if the
# base touched one since the PR branched, the PR must rebase and re-run CI.
function Test-SharedPath([string]$Path) {
    $leaf = Split-Path -Leaf $Path
    return ($leaf -in @("Cargo.lock", "pnpm-lock.yaml", "Cargo.toml", "package.json",
                "pnpm-workspace.yaml", "rust-toolchain.toml") -or
        $Path -eq "apps/desktop/src/bindings.ts" -or
        $Path -eq "apps/desktop/src-tauri/src/lib.rs" -or
        $Path -eq "apps/desktop/src-tauri/tauri.conf.json" -or
        $Path -like "*/migrations/*" -or
        $Path -like ".github/workflows/*")
}


# Test-VisualPath and Get-PrFingerprint.
. (Join-Path $PSScriptRoot "lib/gate-common.ps1")

# Review comments: header on the first non-empty line + "Veredicto: OK|CAMBIOS".
function Get-Reviews($Comments, [string]$Kind) {
    foreach ($c in @($Comments)) {
        $first = @(([string]$c.body) -split "`n" | Where-Object { $_.Trim() }) | Select-Object -First 1
        if ($first -notmatch $HeaderRegex) { continue }
        $isVisual = $Matches.kind -eq "visual"
        if (($Kind -eq "visual") -ne $isVisual) { continue }
        $agent = $Matches.agent.ToLower()
        # ", Antigravity, Gemini 3.8 Flash" -> harness + model.
        $parts = @(($Matches.rest -split ",") | ForEach-Object { $_.Trim() } | Where-Object { $_ })
        $date = ConvertTo-Date $c.createdAt
        $who = if ($parts.Count -gt 0) { "$agent ($($parts -join ', '))" } else { $agent }
        if ($date -ge $IdentitySince -and $parts.Count -lt 2) {
            Fail "la revision de $agent del $($c.createdAt) no identifica harness y modelo: debe empezar con '## Revision ... ($agent, <harness>, <modelo>)' (ADR-0016); vuelve a publicarla"
        }
        $verdict = $null
        if ([string]$c.body -match '(?m)^\s*Veredicto:\s*\**\s*(?<v>OK|CAMBIOS)\b') { $verdict = $Matches.v.ToUpper() }
        $fingerprint = $null
        if ([string]$c.body -match '(?m)^\s*Huella(?: visual)?:\s*`?(?<h>[0-9a-f]{16})\b') { $fingerprint = $Matches.h }
        [pscustomobject]@{ Agent = $agent; Who = $who; Verdict = $verdict; Date = $date; Fingerprint = $fingerprint }
    }
}

# --- 1) PR data and hygiene -----------------------------------------------------
$repoInfo = Get-GhJson @("repo", "view", "--json", "nameWithOwner") "repo"
$repo = [string]$repoInfo.nameWithOwner
if (-not $repo) { Fail "no se pudo resolver el repo" }

$fields = "number,state,isDraft,body,labels,comments,files,headRefOid,baseRefName"
$prJson = Get-GhJson @("pr", "view", "$Pr", "--json", $fields) "pr view"
Assert-Fields $prJson ($fields -split ",") "pr view"
if ($prJson.state -ne "OPEN") { Fail "el PR no esta abierto (estado: $($prJson.state))" }
if ($prJson.isDraft) { Fail "el PR esta en draft" }
if (-not $prJson.headRefOid -or -not $prJson.baseRefName) { Fail "pr view: faltan headRefOid/baseRefName" }

$body = [string]$prJson.body
if ($body -notmatch '(?m)^\*\*Agente:\*\*\s*(?<a>[a-z0-9][a-z0-9-]*)') { Fail "el cuerpo del PR no tiene la linea '**Agente:** <id>'" }
$author = $Matches.a.ToLower()
# Placeholders from the PR template ("<!-- ... -->") do not count.
foreach ($line in @("Harness", "Modelo")) {
    if ($body -notmatch "(?m)^\*\*$($line):\*\*[ \t]*(?<v>[^<\s][^\r\n]*)") {
        Fail "el cuerpo del PR no tiene la linea '**$($line):** ...' (ADR-0016: agente, harness y modelo)"
    }
    Set-Variable -Name "author$line" -Value $Matches.v.Trim()
}
if ($body -notmatch '(?i)\b(Closes|Fixes|Resolves|Parte de)\s+#\d+') { Fail "el cuerpo del PR no dice 'Closes #n' ni 'Parte de #n'" }

$labels = @($prJson.labels | ForEach-Object { $_.name })
$files = @($prJson.files | ForEach-Object { $_.path })
if ($files.Count -eq 0) { Fail "pr view: el PR no reporta archivos" }

# --- 1b) Lanes and size (ADR-0014, .github/lanes.json) ----------------------------
function Test-Match([string]$Path, $Patterns) {
    foreach ($g in @($Patterns)) { if ($Path -like $g) { return $true } }
    return $false
}
$lanesPath = Join-Path (Split-Path -Parent $PSScriptRoot) ".github/lanes.json"
if (-not (Test-Path $lanesPath)) { Fail "no existe .github/lanes.json" }
try { $lanes = Get-Content -Raw -Encoding UTF8 $lanesPath | ConvertFrom-Json } catch { Fail "lanes.json invalido" }
if ($null -eq $lanes.lanes -or $null -eq $lanes.hot -or $null -eq $lanes.generated) { Fail "lanes.json: faltan lanes/hot/generated" }
$own = @($lanes.lanes.PSObject.Properties | Where-Object { @($_.Value.agents) -contains $author } | ForEach-Object { @($_.Value.paths) })
$outside = @($files | Where-Object {
        -not (Test-Match $_ $lanes.generated) -and ((Test-Match $_ $lanes.hot) -or -not (Test-Match $_ $own))
    })
if ($outside.Count -gt 0 -and $labels -notcontains "cross-lane") {
    Fail ("archivos fuera del carril de {0} o calientes, sin el label cross-lane: {1}" -f $author, (($outside | Select-Object -First 5) -join ", "))
}
$added = 0
foreach ($f in @($prJson.files)) {
    if ($null -eq $f.additions) { Fail "pr view: falta additions en $($f.path)" }
    if (-not (Test-Match $f.path $lanes.generated)) { $added += [int]$f.additions }
}
if ($added -gt 400) { Fail "el PR agrega $added lineas sin contar generados (maximo 400): dividelo" }

# --- 2) CI checks ----------------------------------------------------------------
$checks = @(Get-GhJson @("pr", "checks", "$Pr", "--json", "name,bucket") "pr checks")
if ($checks.Count -eq 0) { Fail "el PR no tiene checks (todo PR debe correr ci.yml)" }
$ci = @($checks | Where-Object { $_.name -eq "ci" })
if ($ci.Count -eq 0) { Fail "falta el check 'ci'" }
$notGreen = @($checks | Where-Object { $_.bucket -ne "pass" -and $_.bucket -ne "skipping" })
if ($notGreen.Count -gt 0 -or @($ci | Where-Object { $_.bucket -ne "pass" }).Count -gt 0) {
    Fail ("checks no verdes: {0}" -f (($notGreen | ForEach-Object { "$($_.name)=$($_.bucket)" }) -join ", "))
}

# --- 3) Up to date with the base branch ---------------------------------------------
$base = [string]$prJson.baseRefName
$head = [string]$prJson.headRefOid
$cmp = Get-GhJson @("api", "repos/$repo/compare/$base...$head") "compare"
if ($null -eq $cmp.behind_by) { Fail "compare: falta behind_by" }
$behind = [int]$cmp.behind_by
$freshness = "al dia con $base"
if ($behind -gt 0) {
    # Files changed on the base since the PR branched (compare head...base).
    $back = Get-GhJson @("api", "repos/$repo/compare/$head...$base") "compare base"
    if ($null -eq $back.files) { Fail "compare base: falta la lista de archivos" }
    $baseFiles = @($back.files | ForEach-Object { $_.filename })
    # GitHub truncates compare at 300 files: too much drift to reason about.
    if ($baseFiles.Count -ge 300) { Fail "el PR esta $behind commit(s) detras de $($base) con demasiados cambios: rebasa" }
    $overlap = @($baseFiles | Where-Object { $files -contains $_ })
    if ($overlap.Count -gt 0) {
        Fail ("el PR esta {0} commit(s) detras de {1} y {1} cambio archivos del PR ({2}): rebasa y vuelve a pasar CI" -f $behind, $base, (($overlap | Select-Object -First 5) -join ", "))
    }
    $shared = @($baseFiles | Where-Object { Test-SharedPath $_ })
    if ($shared.Count -gt 0) {
        Fail ("el PR esta {0} commit(s) detras de {1} y {1} cambio archivos compartidos ({2}): rebasa y vuelve a pasar CI" -f $behind, $base, (($shared | Select-Object -First 5) -join ", "))
    }
    $freshness = "$behind commit(s) detras de $base sin solape"
}

# --- 4) Base branch must be green (freeze) --------------------------------------------
$runs = @(Get-GhJson @("run", "list", "--workflow", "ci.yml", "--branch", $base, "--status", "completed", "-L", "20", "--json", "conclusion,headSha") "run list")
$lastRun = @($runs | Where-Object { $_.conclusion -in @("success", "failure", "timed_out", "startup_failure") }) | Select-Object -First 1
if ($null -eq $lastRun) { Fail "no hay runs terminados de ci.yml en $base" }
if ($lastRun.conclusion -ne "success" -and $labels -notcontains "fix:main") {
    Fail "$base esta en rojo (ci.yml $($lastRun.conclusion) en $($lastRun.headSha)): solo entran PRs con label fix:main"
}

# Current fingerprint of the PR (same algorithm as scripts/pr-fingerprint.ps1).
$fileLines = $null
function Get-CurrentFingerprint([switch]$Visual) {
    if ($null -eq $script:fileLines) {
        # --slurp: one JSON array of pages. (No --jq with quotes: Windows
        # PowerShell 5.1 splits native arguments that contain them.)
        $pages = @(Get-GhJson @("api", "--paginate", "--slurp", "repos/$repo/pulls/$Pr/files?per_page=100") "files")
        $script:fileLines = @($pages | ForEach-Object { $_ } | ForEach-Object { "$($_.filename) $($_.sha)" })
        if ($script:fileLines.Count -eq 0) { Fail "files: el PR no reporta archivos" }
    }
    Get-PrFingerprint $script:fileLines -Visual:$Visual
}

# Commits authored after a given date; rebases keep author dates.
$commits = $null
function Get-CommitsAfter([DateTimeOffset]$Since) {
    if ($null -eq $script:commits) {
        $script:commits = @(Get-GhJson @("api", "repos/$repo/pulls/$Pr/commits?per_page=100") "commits")
        if ($script:commits.Count -eq 0) { Fail "commits: el PR no reporta commits" }
    }
    @($script:commits | Where-Object { (ConvertTo-Date $_.commit.author.date) -gt $Since })
}

# --- 5) Code review by another agent ------------------------------------------------
$codeReviews = @(Get-Reviews $prJson.comments "code" | Where-Object { $_.Agent -ne $author })
if ($codeReviews.Count -eq 0) { Fail "no hay revision de codigo de un agente distinto al autor ($author)" }
$lastCode = $codeReviews[-1]
if ($lastCode.Verdict -ne "OK") { Fail "la ultima revision de codigo ($($lastCode.Agent)) no es OK: $($lastCode.Verdict)" }
# A review with "Huella:" is valid exactly while the reviewed content is
# unchanged; without it, no commit may be AUTHORED after the review.
$late = @()
if ($lastCode.Fingerprint) {
    if ($lastCode.Fingerprint -ne (Get-CurrentFingerprint)) { Fail "la huella de la revision de codigo no coincide: hay cambios sin revisar" }
} else {
    $late = @(Get-CommitsAfter $lastCode.Date)
}
if ($late.Count -gt 0) { Fail ("hay commits autoreados despues de la revision de codigo: {0}" -f (($late | ForEach-Object { $_.sha.Substring(0, 7) }) -join ", ")) }

# --- 6) Visual review ---------------------------------------------------------------
if ($labels -contains "needs:vision") { Fail "el PR tiene el label needs:vision (en cola de revision visual)" }
$visualFiles = @($files | Where-Object { Test-VisualPath $_ })
$visualWord = "no requerida (sin cambios visuales)"
if ($visualFiles.Count -gt 0) {
    $visualReviews = @(Get-Reviews $prJson.comments "visual" | Where-Object { $VisionAgents -contains $_.Agent })
    if ($visualReviews.Count -eq 0) { Fail "el PR cambia archivos visuales (ej: $($visualFiles[0])) y no tiene revision visual" }
    $lastVisual = $visualReviews[-1]
    if ($lastVisual.Verdict -ne "OK") { Fail "el ultimo veredicto visual ($($lastVisual.Agent)) no es OK: $($lastVisual.Verdict)" }
    $sinceOk = @()
    if ($lastVisual.Fingerprint) {
        if ($lastVisual.Fingerprint -ne (Get-CurrentFingerprint -Visual)) { Fail "la huella visual no coincide: hay cambios visuales sin revisar" }
    } else {
        $sinceOk = @(Get-CommitsAfter $lastVisual.Date)
    }
    foreach ($c in $sinceOk) {
        $cJson = Get-GhJson @("api", "repos/$repo/commits/$($c.sha)") "commit $($c.sha)"
        $cVisual = @($cJson.files | ForEach-Object { $_.filename } | Where-Object { Test-VisualPath $_ })
        if ($cVisual.Count -gt 0) {
            Fail ("commit {0} (autor {1}) cambia archivos visuales posteriores al OK: {2}" -f $c.sha.Substring(0, 7), $c.commit.author.date, ($cVisual -join ", "))
        }
    }
    $visualWord = "aprobada ($($lastVisual.Who))"
}

# --- 7) Squash merge ------------------------------------------------------------------
Write-Output "merge-gate: OK (CI verde; $freshness; autor $author ($authorHarness, $authorModelo); codigo revisado por $($lastCode.Who); revision visual $visualWord)"
if ($DryRun) {
    Write-Output "merge-gate: DRY-RUN, no se mergea"
    exit 0
}

# --match-head-commit: refuse if someone pushed after the checks above.
# gh pr merge exits 1 when the LOCAL branch cannot be deleted (e.g. checked
# out in a worktree); the authoritative outcome is the PR state.
(& gh pr merge $Pr --squash --delete-branch --match-head-commit $head 2>&1) | Out-String | Write-Output
$state = (Invoke-Gh @("pr", "view", "$Pr", "--json", "state", "--jq", ".state")).Trim()
if ($state -ne "MERGED") { Fail "el PR no quedo mergeado (estado: $state)" }

# --- 8) Clean status:* labels on the closing issues (best effort: already merged) -----
$issueNumbers = (& gh pr view $Pr --json closingIssuesReferences --jq ".closingIssuesReferences[].number")
foreach ($n in @($issueNumbers)) {
    if (-not $n) { continue }
    $issueLabels = (& gh issue view $n --json labels --jq ".labels[].name")
    foreach ($label in @($issueLabels | Where-Object { $_ -like "status:*" })) {
        (& gh issue edit $n --remove-label $label) | Out-Null
        Write-Output "merge-gate: label '$label' removido del issue #$n"
    }
}

Write-Output "merge-gate: PR #$Pr mergeado."
exit 0
