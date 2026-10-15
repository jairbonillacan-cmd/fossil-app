# AGENTS.md — apps/desktop

Shell Tauri 2 de Fossil: UI en `src/` (React 19 + Vite + Tailwind v4), backend en `src-tauri/` (crate `fossil-desktop`).

- Comandos (desde aquí): `pnpm.cmd tauri dev` (app completa), `pnpm.cmd dev` (solo Vite), `pnpm.cmd test`, `pnpm.cmd typecheck`. Desde la raíz: `pnpm.cmd dev` / `pnpm.cmd build`.
- La ventana `main` es `transparent` + `windowEffects: mica` (ver `src-tauri/tauri.conf.json`); el fondo del `html/body` es transparente con fallback sólido en `prefers-reduced-transparency`.
- El plugin single-instance se registra **primero** dentro de `setup` (`#[cfg(desktop)]`); no tiene API JS.
- CSP restrictiva en `tauri.conf.json` (`devCsp` extra para el HMR de Vite en el puerto 1420).
- Los comandos IPC se tipan con tauri-specta a partir de #4 (`src/bindings.ts`, generado en debug y commitado).
- Mapa completo: `docs/modules/infra.md`.
