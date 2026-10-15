# Spec R0: Fundaciones

**Objetivo:** dejar un monorepo que compila, prueba y empaqueta Fossil en Windows con CI, para que cualquier agente pueda trabajar siguiendo `AGENTS.md`.

## Alcance
1. **Toolchain y workspaces**
   - `package.json` raíz con pnpm workspaces (`apps/*`, `packages/*`) y los scripts `dev`, `check`, `build`, `fmt`.
   - `Cargo.toml` de workspace (`crates/*`, `apps/desktop/src-tauri`).
   - Fijar versiones con `rust-toolchain.toml` (stable, target MSVC) y `packageManager` en el `package.json`.
   - Biome (`biome.json`), `tsconfig.base.json` estricto, `.editorconfig` y `rustfmt.toml`.
2. **App desktop** (`apps/desktop`)
   - Tauri 2 + React 19 + TS + Vite + Tailwind v4.
   - Ventana sin marco con controles nativos y efecto **Mica** (`window-vibrancy`); fallback a fondo sólido si Mica no está disponible.
   - Plugins `single-instance` y `window-state`.
   - **tauri-specta** configurado. Un comando de ejemplo `app_info() -> AppInfo { version, data_dir }` con tipos generados en `apps/desktop/src/bindings.ts`.
   - Íconos generados con `pnpm tauri icon` a partir de un `app-icon.svg` provisional.
3. **Crates vacíos**
   - `crates/fossil-core`, `fossil-ai`, `fossil-bridge`, `fossil-mcp`, `fossil-data`, `fossil-os` y `fossil-proto`.
   - Cada uno con su `lib.rs`, un test y un `AGENTS.md` de 5–10 líneas.
4. **Design system base** (`packages/ui`)
   - Tokens CSS claro/oscuro según `docs/DESIGN.md`.
   - Fuentes Inter y JetBrains Mono (self-hosted).
   - Componentes `Button` y `Input` de ejemplo.
5. **i18n**: base con `i18next`, es-MX por defecto y en.
6. **CI** (`.github/workflows/`)
   - `ci.yml` en `windows-latest`, con caché de pnpm y cargo, que ejecuta:
     - `pnpm install --frozen-lockfile`
     - `pnpm check`
     - `cargo fmt --check`
     - `cargo clippy -D warnings`
     - `cargo nextest run`
   - `release.yml`: con un tag `v*`, `tauri-action` genera el instalador NSIS y crea un release en draft.
   - `perf.yml`: compila release y mide tamaño del instalador, tiempo hasta la ventana y RAM del árbol de procesos (incluido `msedgewebview2`) con `scripts/perf.ps1`. Comenta los resultados en el PR y falla si supera los presupuestos de `docs/DOD.md`.
7. **GitHub**: protección de `main` (PR + CI verde obligatorios). Es tarea del PO.

## Criterios de aceptación
- `pnpm install && pnpm dev` abre la ventana de Fossil con Mica y muestra versión y carpeta de datos, obtenidas vía el comando tipado.
- `pnpm check`, `cargo clippy` y `cargo nextest` pasan en verde, en local y en CI.
- `pnpm build` genera un `.exe` NSIS de < 30 MB.
- `perf.yml` publica sus métricas como comentario en el PR.

## Fuera de alcance
Editor, almacenamiento y cualquier feature de producto (empiezan en R1).

## Riesgos
- Las versiones RC de tauri-specta pueden romperse: fija versiones exactas (`=`) y documenta en `docs/modules/infra.md` cómo actualizarlas.
