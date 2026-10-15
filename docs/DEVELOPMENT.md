# Guía de desarrollo

> **Última revisión:** 2026-10-15 · **Última actualización:** 2026-10-15 · **Cambio:** primera versión; resume `docs/modules/infra.md`, que conserva el detalle

## Requisitos

Solo Windows 11 x64. Ninguno necesita permisos de administrador salvo Visual Studio Build Tools.

| Herramienta | Instalar | Verificar |
|---|---|---|
| Rust (host `x86_64-pc-windows-msvc`; `rust-toolchain.toml` fija el canal estable) | `winget install --id Rustlang.Rustup -e` | `rustc --version` |
| Visual Studio Build Tools 2022 con C++ (**admin**) | `winget install --id Microsoft.VisualStudio.2022.BuildTools -e --override "--add Microsoft.VisualStudio.Workload.VCTools --includeRecommended --passive --wait --norestart"` | `cargo build` compila |
| Node.js 22 LTS o superior | `winget install OpenJS.NodeJS.LTS` | `node --version` |
| pnpm (versión fijada en `packageManager`) | ver abajo | `pnpm --version` |
| cargo-nextest | `cargo install cargo-nextest --locked` | `cargo nextest --version` |
| WebView2 Runtime | Incluido en Windows 11 | — |

pnpm sin permisos de administrador (`corepack enable` a secas falla con `EPERM`):

```powershell
New-Item -ItemType Directory -Force "$env:APPDATA\npm" | Out-Null
corepack enable pnpm --install-directory "$env:APPDATA\npm"
```

## Compilar y correr

```powershell
pnpm install                 # dependencias JS (no edites pnpm-lock.yaml a mano)
pnpm dev                     # Fossil en modo desarrollo, con recarga en caliente
pnpm build                   # instalador NSIS en target/release/bundle/nsis/
pnpm --filter @fossil/editor dev   # solo el editor, en el navegador (playground)
```

| Script (`package.json`) | Qué corre |
|---|---|
| `pnpm check` | `biome check .` + `typecheck` y `test` de cada paquete |
| `pnpm fmt` | Biome con `--write` y `cargo fmt --all` |
| `pnpm lint:rust` | `cargo clippy --workspace --all-targets -- -D warnings` |
| `pnpm test:rust` | `cargo nextest run --workspace` |

Si PowerShell bloquea `pnpm.ps1`, usa `pnpm.cmd` o ajusta la política de ejecución de tu usuario.

## Varios worktrees, un solo target

Cada worktree compilaría su propio `target/` de varios GB. Comparte uno:

```powershell
$env:CARGO_TARGET_DIR = "$env:USERPROFILE\fossil-target"
```

## Cambiar el contrato entre Rust y TypeScript

1. Escribe el comando en `apps/desktop/src-tauri/src/commands/<área>.rs` con `#[tauri::command]` y
   `#[specta::specta]`; los tipos derivan `Serialize` y `specta::Type`; los errores, `thiserror`.
2. Regístralo en `collect_commands!` (`apps/desktop/src-tauri/src/lib.rs`).
3. Corre `cargo nextest run --workspace` o `pnpm dev`: regeneran `apps/desktop/src/bindings.ts`.
4. Haz commit de `bindings.ts`. CI falla si no coincide con el Rust.

En TypeScript el comando aparece en camelCase (`object_get` → `commands.objectGet`); los campos de
los tipos conservan snake_case.

## Capturas

`scripts/capture-window.ps1 -Out <archivo.png>` trae la ventana de Fossil al frente y captura solo
esa ventana, con Mica tal como se ve. Necesita `pnpm dev` corriendo. Toma cada captura en tema
claro y oscuro, con datos de ejemplo (Acme, "Mi equipo") y sin rutas personales a la vista.

## Depurar

| Síntoma | Causa y solución |
|---|---|
| Los tests de Rust terminan con `0xc0000139` | Falta el manifiesto de comctl32 v6. `src-tauri/build.rs` lo incrusta; no lo quites |
| `tauri-build` no compila | Faltan los íconos: `pnpm --filter @fossil/desktop tauri icon app-icon.svg` |
| `cargo` no se encuentra tras instalar rustup | Reinicia la terminal o el editor para que lean el nuevo PATH |
| La ventana sale con fondo plano en vez de Mica | Windows no está componiendo transparencias (ventana inactiva, ahorro de energía). Ver `DESIGN.md` § Fondo |
| `pnpm-lock.yaml` cambió sin tocar dependencias | Descártalo: `git checkout -- pnpm-lock.yaml` |

Las herramientas de desarrollo de WebView2 se abren con `Ctrl+Shift+I` en `pnpm dev`. Los logs de
Rust salen en la terminal que corre `pnpm dev`.

## Más detalle

- [`modules/infra.md`](modules/infra.md): toolchain, monorepo, CI, release y sitio público.
- [`TESTING.md`](TESTING.md) · [`PERFORMANCE.md`](PERFORMANCE.md) · [`RELEASING.md`](RELEASING.md).
