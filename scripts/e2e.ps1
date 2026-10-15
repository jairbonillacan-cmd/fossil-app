# End-to-end test runner for Fossil (#15).
# 1. Runs the end-to-end key flow suite (create page, [[wikilink]], Enlazada
#    desde backlinks panel, and FTS5 search_query).
# 2. When tauri-driver, msedgedriver, and fossil-desktop.exe are available (or
#    when -RequireWebDriver is set), starts a W3C WebDriver session over
#    http://127.0.0.1:4444 and verifies the live desktop binary.
# Usage: powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/e2e.ps1 [-RequireWebDriver]
param(
    [switch]$RequireWebDriver,
    [int]$Port = 4444
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$targetDir = if ($env:CARGO_TARGET_DIR) { $env:CARGO_TARGET_DIR } else { Join-Path $root "target" }
$exe = Join-Path $targetDir "release\fossil-desktop.exe"

Write-Output "e2e: ejecutando flujos clave (crear pagina, enlace [[ ]], Enlazada desde y busqueda)..."
Push-Location $root
try {
    & pnpm.cmd --filter @fossil/desktop test src/e2e-flows.test.tsx
    if ($LASTEXITCODE -ne 0) {
        Write-Error "e2e: fallo la suite de flujos e2e en @fossil/desktop"
        exit 1
    }
} finally {
    Pop-Location
}

$tauriDriver = Get-Command tauri-driver -ErrorAction SilentlyContinue
$edgeDriver = Get-Command msedgedriver -ErrorAction SilentlyContinue
if (-not $edgeDriver -and $env:EDGEWEBDRIVER) {
    $candidate = Join-Path $env:EDGEWEBDRIVER "msedgedriver.exe"
    if (Test-Path $candidate) { $edgeDriver = @{ Source = $candidate } }
}

if (-not $tauriDriver -or -not $edgeDriver -or -not (Test-Path $exe)) {
    if ($RequireWebDriver) {
        Write-Error "e2e: -RequireWebDriver activo pero falta tauri-driver, msedgedriver o $exe"
        exit 1
    }
    Write-Output "e2e: OK (suite de flujos clave verificada; tauri-driver/binario release opcional fuera de sesion WebDriver)."
    exit 0
}

Write-Output "e2e: iniciando tauri-driver en 127.0.0.1:$Port con $($edgeDriver.Source)..."
$driverProc = Start-Process -FilePath $tauriDriver.Source `
    -ArgumentList @("--port", "$Port", "--native-driver", $edgeDriver.Source) `
    -PassThru -WindowStyle Hidden

$sessionId = $null
$tempVault = Join-Path ([System.IO.Path]::GetTempPath()) ("fossil-e2e-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force -Path $tempVault | Out-Null

function Invoke-Wd([string]$Method, [string]$Path, $Body = $null) {
    $uri = "http://127.0.0.1:$Port$Path"
    $params = @{ Method = $Method; Uri = $uri; ContentType = "application/json"; TimeoutSec = 30 }
    if ($null -ne $Body) { $params.Body = ($Body | ConvertTo-Json -Depth 10 -Compress) }
    return Invoke-RestMethod @params
}

try {
    Start-Sleep -Milliseconds 600
    $caps = @{
        capabilities = @{
            alwaysMatch = @{
                "tauri:options" = @{
                    application = (Resolve-Path $exe).Path
                }
            }
        }
    }
    $session = Invoke-Wd "POST" "/session" $caps
    $sessionId = [string]$session.value.sessionId
    if (-not $sessionId) { throw "tauri-driver no devolvio sessionId" }

    $script = @"
const done = arguments[arguments.length - 1];
(async () => {
  const invoke = window.__TAURI_INTERNALS__.invoke;
  const vaultPath = $($tempVault | ConvertTo-Json);
  await invoke("vault_create", { path: vaultPath, name: "Mi equipo" });
  const p1 = await invoke("object_create", { meta: { types: ["Page"], title: "Plan Q4", icon: null, parent: null } });
  const p2 = await invoke("object_create", { meta: { types: ["Page"], title: "Campana Acme", icon: null, parent: null } });
  const list = await invoke("object_list", { filter: { include_archived: false, type_key: null, parent: null, query: null } });
  const hits = await invoke("search_query", { query: { text: "Plan", type_key: null, tag: null, updated_from: null, updated_to: null, limit: 10 } });
  done({ ok: list.length >= 2 && hits.length >= 1, count: list.length, hits: hits.length, p1: p1.id, p2: p2.id });
})().catch(e => done({ ok: false, error: String(e) }));
"@
    $res = Invoke-Wd "POST" "/session/$sessionId/execute/async" @{ script = $script; args = @() }
    if (-not $res.value.ok) {
        throw "WebDriver flujo e2e fallo: $($res.value | ConvertTo-Json -Compress)"
    }
    Write-Output "e2e: WebDriver tauri-driver OK (objetos=$($res.value.count), hits=$($res.value.hits))."
} finally {
    if ($sessionId) {
        try { Invoke-Wd "DELETE" "/session/$sessionId" | Out-Null } catch { }
    }
    if ($driverProc -and -not $driverProc.HasExited) {
        Stop-Process -Id $driverProc.Id -Force -ErrorAction SilentlyContinue
    }
    Remove-Item -Recurse -Force $tempVault -ErrorAction SilentlyContinue
}
exit 0
