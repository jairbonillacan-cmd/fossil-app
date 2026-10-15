# infra
**Propósito:** toolchain, monorepo, build, CI y release de Fossil (solo Windows).
**Rutas:** raíz (`package.json`, `Cargo.toml`), `apps/desktop/`, `.github/workflows/`, `scripts/`
**Contratos públicos:** comandos IPC tipados en `apps/desktop/src/bindings.ts` (generado con tauri-specta; comando ejemplo `appInfo`).

## Toolchain local (Windows 11, x64)
| Herramienta | Instalación (sin admin salvo VS) | Verificar |
|---|---|---|
| Rust (rustup, host `x86_64-pc-windows-msvc`) | `winget install --id Rustlang.Rustup -e` | `rustc --version` · `rustup show` |
| VS Build Tools 2022 + C++ (MSVC, Windows SDK) — **requiere admin** | ver abajo | `& "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe" -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath` |
| Node.js ≥ 22 LTS | `winget install OpenJS.NodeJS.LTS` | `node --version` |
| pnpm (vía corepack, versión fijada en `packageManager`) | ver abajo | `pnpm --version` |
| WebView2 Runtime | incluido en Windows 11 | — |

**VS Build Tools** (en una terminal de PowerShell **como administrador**):
```powershell
winget install --id Microsoft.VisualStudio.2022.BuildTools -e --override "--add Microsoft.VisualStudio.Workload.VCTools --includeRecommended --passive --wait --norestart"
```

**pnpm sin admin** (`corepack enable` a secas intenta escribir en `C:\Program Files\nodejs` y falla con EPERM):
```powershell
New-Item -ItemType Directory -Force "$env:APPDATA\npm" | Out-Null
corepack enable pnpm --install-directory "$env:APPDATA\npm"
pnpm --version   # corepack descarga la versión de "packageManager"
```

## Gotchas
- **Execution policy:** si PowerShell no deja cargar `npm.ps1`/`pnpm.ps1`, usa `npm.cmd`/`pnpm.cmd` o ejecuta `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` (decisión de cada usuario).
- **PATH:** tras instalar rustup, `~\.cargo\bin` queda en el PATH de usuario, pero las terminales ya abiertas (y el IDE) no lo ven hasta reiniciarse.
- **UAC:** los agentes no pueden elevar permisos; VS Build Tools lo instala el PO una vez. CI (`windows-latest`) ya trae MSVC.
- No leas `target/`, `node_modules/` ni lockfiles.
- **Cargo:** un glob de `members` sin coincidencias rompe Cargo; añade cada miembro cuando exista.
- **Lints:** `clippy::unwrap_used`/`expect_used` en `warn` (con `-D warnings` = error). En tests están permitidos (`clippy.toml`); en producción, `#[allow]` + comentario que lo justifique.
- **tauri-build exige ícono:** sin `src-tauri/icons/icon.ico` (y `bundle.icon` en `tauri.conf.json`) no compila el workspace. Se regeneran con `pnpm.cmd --filter @fossil/desktop tauri icon app-icon.svg` (SVG provisional en `apps/desktop/`).
- **Tests Rust + comctl32:** los binarios de test crashean con `0xc0000139` (`TaskDialogIndirect` no existe en comctl32 v5, tauri-apps/tauri#13419). Fix en `src-tauri/build.rs`: manifest propio (`windows-app-manifest.xml`) embebido con `/MANIFEST:EMBED` para todos los binarios, desactivando el de tauri-build.

## Contratos IPC (tauri-specta)
- Comandos en `apps/desktop/src-tauri/src/commands.rs`; el builder specta vive en `lib.rs::specta_builder`.
- **Añadir un comando:** fn con `#[tauri::command]` + `#[specta::specta]`, agrégala a `collect_commands![...]`, corre un build debug (`pnpm.cmd dev` o `cargo nextest run --workspace` — el test smoke regenera el archivo) y **committea** `apps/desktop/src/bindings.ts` regenerado. Tipos: `Serialize` + `specta::Type`; errores tipados con `thiserror` (serializan como string-union en TS). El nombre en TS es camelCase (`app_info` → `commands.appInfo`) y los campos de tipos siguen snake_case.
- **Versiones (RC, fijadas con `=` en `src-tauri/Cargo.toml`):** `tauri-specta =2.0.0-rc.25` (features `derive`+`typescript`), `specta =2.0.0-rc.25`, `specta-typescript =0.0.12`. Para actualizar: cambia los tres pins juntos (tauri-specta exige specta exacto), corre `cargo update -w`, arregla breaking changes del RC y verifica UI + tests.
- `bindings.ts` está excluido de Biome pero entra al typecheck; no editar a mano.

## App desktop (`apps/desktop`)
- Paquete `@fossil/desktop` (React 19 + Vite + Tailwind v4 en `src/`); crate `fossil-desktop` en `src-tauri/` (workspace member).
- Ventana `main`: `transparent` + `windowEffects: ["mica"]` en `tauri.conf.json` (Tauri usa `window-vibrancy` internamente; no hace falta el crate directo). El fondo del `html/body` es transparente; el fallback sólido vive en `styles.css` (`prefers-reduced-transparency`).
- Se mantienen `decorations` nativas (controles de Windows): Tauri 2 no puede quitar el marco y conservar controles nativos (#3 lo documenta).
- Plugins: `single-instance` (se registra **primero**, en `setup`, `#[cfg(desktop)]`; sin API JS) y `window-state` (estado en `%APPDATA%\io.github.jairbonillacan-cmd.fossil\.window-state.json`).
- CSP restrictiva (`csp`) + `devCsp` que abre `ws://localhost:1420` para el HMR de Vite.
- Ícono provisional "F" (`apps/desktop/app-icon.svg`: cuadrado negro redondeado `rx=192` con borde interior neutro `#333333` y "F" blanca alineada a múltiplos de 64 unidades sobre `1024×1024` para escalado exacto a 16/32 px); el logo real lo decide el PO.
- Desde la raíz: `pnpm.cmd dev` abre la app; `pnpm.cmd --filter @fossil/desktop dev` solo Vite.

## Monorepo
| Archivo | Qué fija |
|---|---|
| `package.json` | `packageManager` (pnpm), scripts `dev`, `check`, `build`, `fmt`, `lint:rust`, `test:rust` |
| `pnpm-workspace.yaml` | paquetes `apps/*`, `packages/*` |
| `Cargo.toml` | workspace Rust, `[workspace.lints]`, perfil release optimizado para tamaño |
| `rust-toolchain.toml` | stable + MSVC + rustfmt/clippy |
| `biome.json` · `tsconfig.base.json` | lint/formato JS/TS · TS estricto (cada paquete lo extiende) |

**Crates Rust (`crates/`, todos heredan `[workspace.package]` y `[workspace.lints]`):**
`fossil-core` (dominio: objetos, CRDT, SQLite) · `fossil-ai` (router de IA y APIs) · `fossil-bridge` (CLIs locales como procesos hijo, ADR-0011) · `fossil-mcp` (cliente/servidor MCP) · `fossil-data` (ingesta y análisis de datos) · `fossil-os` (integración Windows) · `fossil-proto` (contratos wire con cloud/portal). En R0 son placeholders: `lib.rs` + test + `AGENTS.md` propio.

`pnpm check` = `biome check .` + `typecheck` y `test` de cada paquete que los defina (`pnpm -r --if-present`).

## Cómo probar
```
rustc --version; cargo --version; pnpm --version
pnpm install; pnpm check
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/e2e.ps1
cargo clippy --workspace --all-targets -- -D warnings; cargo nextest run --workspace
```

## CI
`.github/workflows/ci.yml`: job `ci` en `windows-latest` (nombre estable para el gate de merges, ADR-0012). Corre en cada PR y push a `main`: `pnpm install --frozen-lockfile` → tests del merge gate (`scripts/tests/merge-gate.tests.ps1`, Windows PowerShell 5.1, `gh` simulado) → `pnpm check` → `scripts/e2e.ps1` (flujos clave e2e + sesión WebDriver `tauri-driver` cuando hay binario release) → `cargo fmt --all --check` → `cargo clippy --workspace --all-targets -- -D warnings` → `cargo nextest run --workspace` → `git diff --exit-code -- apps/desktop/src/bindings.ts` (el contrato generado y el Rust deben coincidir). Cachés: pnpm (setup-node) y cargo (`Swatinem/rust-cache@v2`); `cargo-nextest` se instala con `taiki-e/install-action`. **El PR que agrega o cambia CI debe mostrarlo en verde en sí mismo.**

## Release
`.github/workflows/release.yml`: con un tag `v*`, `tauri-apps/tauri-action@v1` compila el bundle NSIS y crea un release en **draft** (publicarlo es manual). Subir cambios en `.github/workflows/` requiere el scope `workflow` del token (`gh auth refresh -s workflow`). Instalador local: `pnpm.cmd build` → `target/release/bundle/nsis/` (presupuesto < 30 MB, `docs/DOD.md`).

## Sitio público
`.github/workflows/site.yml`: después de cada merge a `main` que toca `site/**`, `CHANGELOG.md` o `ROADMAP.md` (o a mano con `workflow_dispatch`), construye `site/` con el Vite de `apps/desktop` y lo publica en Cloudflare Pages (proyecto `fossil-site`, dominio `auralisgo.com`) con `wrangler pages deploy` (versión fija en el workflow); solo publica desde `main`. Necesita los secrets `CLOUDFLARE_API_TOKEN` (permiso Cloudflare Pages: Edit) y `CLOUDFLARE_ACCOUNT_ID`. Sin ellos, construye y avisa, pero no publica. Local: `apps/desktop/node_modules/.bin/vite --config site/vite.config.mjs` (http://localhost:1450). `perf.yml` ignora `site/**`.

## Perf
`.github/workflows/perf.yml` + `scripts/perf.ps1`: en cada PR, compila release y mide (1) tamaño del instalador NSIS, (2) arranque en frío hasta ventana visible y (3) RAM en reposo como **commit privado del árbol de procesos** (fossil-desktop + hijos msedgewebview2; sumar WorkingSet duplicaría memoria compartida). Comenta la tabla en el PR y falla si se rompe un presupuesto de `docs/DOD.md`. Local: `powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/perf.ps1` (requiere `pnpm.cmd build` previo; escribe `perf-report.md`). Baseline R0: instalador 1.1 MB · arranque 0.2–0.6 s · RAM ~158 MB.

**ADRs relacionados:** 0001 (Tauri 2), 0009 (GitHub Issues)

## Capturas
`scripts/capture-window.ps1 -Out <png>`: captura **solo** la ventana de Fossil (proceso `fossil-desktop`), primero la trae al frente y luego copia sus límites DWM, así que Mica sale tal cual se ve. La usan los constructores y `antigravity-vision`. `pnpm.cmd dev` debe estar corriendo.

## CI: filtros por ruta y concurrencia
- **El job `ci` siempre corre y siempre reporta un resultado**: el gate lo exige en todos los PRs. Solo se saltan los pasos que el cambio no puede afectar. El paso `Detect changed areas` compara el merge commit del PR con su base (`git diff HEAD^1 HEAD`).

  | El PR toca | JS (install + `pnpm check`) | Rust (fmt, clippy, nextest, drift de `bindings.ts`) |
  |---|---|---|
  | Solo `docs/**` o `*.md` | se salta | se salta |
  | TS/CSS/scripts, sin Rust | corre | se salta |
  | `crates/`, `apps/desktop/src-tauri/`, `Cargo.*`, `rust-toolchain.toml`, `rustfmt.toml`, `clippy.toml`, `.cargo/`, `.config/nextest.toml`, `deny.toml`, `.github/workflows/` o `bindings.ts` | corre | corre |

  El diff usa `--no-renames` (un archivo movido cuenta también en su ruta vieja) y `core.quotepath=false` (las rutas con acentos no salen entre comillas). **Si añades un archivo de configuración de Rust nuevo, agrégalo al patrón.**

- Los tests del gate y el denylist corren **siempre**. Un push a `main`, un error del diff o un diff vacío corren **todo**: ante la duda se verifica de más.
- **Concurrencia:** un push nuevo a un PR cancela su corrida anterior; en `main` cada commit termina su CI (`cancel-in-progress` solo en `pull_request`).
- **Store de pnpm:** ya es por runner gracias a `dest` por runner en `pnpm/action-setup` (el store vive dentro de esa carpeta). El `os error 183` de #123 (2026-10-15) fue en el `node_modules` del workspace, causa no aclarada; si reaparece, `gh run rerun <id> --failed`.
