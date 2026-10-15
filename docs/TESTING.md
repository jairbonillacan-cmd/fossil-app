# Pruebas

> **Última revisión:** 2026-10-15 · **Última actualización:** 2026-10-15 · **Cambio:** primera versión

Todo cambio llega con pruebas. Esta página dice qué niveles hay, dónde viven y cómo escribir una.

## Niveles

| Nivel | Herramienta | Dónde | Corre en |
|---|---|---|---|
| Unitarias de Rust | `cargo nextest` | `#[cfg(test)] mod tests` al final de cada archivo de `crates/` y `src-tauri/` | CI, cada PR que toca Rust |
| Propiedades | `proptest` | `fossil-core`: convergencia de updates de Yjs en cualquier orden | CI |
| Componentes y lógica de TS | Vitest + Testing Library | `*.test.ts(x)` junto al archivo que prueban | CI, cada PR que toca TS |
| Contrato | Diff de `bindings.ts` | Paso de CI tras los tests de Rust | CI |
| Merge gate | PowerShell con un `gh` simulado, sin red | `scripts/tests/merge-gate.tests.ps1` | CI, siempre |
| Rendimiento | `scripts/perf.ps1` | Instalador, arranque, RAM ([`PERFORMANCE.md`](PERFORMANCE.md)) | `perf.yml`, PRs de código |
| Denylist | `scripts/check-denylist.ps1` | Todo el repo | CI, siempre |
| Visual | Capturas y revisión humana o de agente | Adjuntas al PR | Cada PR con interfaz |
| De extremo a extremo | WebDriver (`tauri-driver`) | Por crear | R1 (pendiente) |

Contados el 2026-10-15: 58 pruebas de Rust y 77 de Vitest ([`STATUS.md`](STATUS.md)).

## Correr

```powershell
cargo nextest run --workspace                 # todo Rust
cargo nextest run -p fossil-core search       # un crate, filtrado por nombre
pnpm check                                    # Biome + tipos + Vitest de todos los paquetes
pnpm --filter @fossil/editor test             # Vitest de un paquete
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/tests/merge-gate.tests.ps1
```

## Escribir una prueba

- **Prueba el comportamiento, no la implementación.** Un test de `fossil-core` abre un Espacio
  temporal (`tempfile`), llama la API pública y revisa el resultado en SQLite o en disco.
- **Cada error arreglado deja una prueba** que fallaba antes del arreglo.
- **Entradas hostiles.** Rutas con `..`, `\` y `/` mezclados, títulos con caracteres prohibidos en
  Windows, mayúsculas que solo cambian de caso, updates de Yjs corruptos: el código devuelve error,
  nunca entra en pánico. `attachments.rs` y `markdown.rs` tienen ejemplos.
- **Interfaz.** Busca por rol y texto visible (`getByRole`, `getByText`), no por clases. Los textos
  vienen de i18n: prueba al menos es-MX.
- **Sin red.** Las pruebas no llaman servicios reales. Los proveedores de IA se prueban con
  tramas SSE escritas en el propio test (`fossil-ai::http`, `fossil-ai::anthropic`).
- **Determinismo.** Fechas fijas (`journal.rs` usa `date(14)`), IDs inyectados donde importe el orden.
- **`unwrap` y `expect`** están permitidos en tests (`clippy.toml`), no en código de producción.

## Datos de prueba

Solo datos inventados y neutros: *Acme*, *Mi equipo*, "Plan Q4", rutas bajo un directorio temporal o
`$env:USERPROFILE`. Ningún nombre de cliente, persona real o producto de terceros; CI lo revisa con
el denylist.
