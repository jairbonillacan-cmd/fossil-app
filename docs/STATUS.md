# Estado de Fossil

> **Última revisión:** 2026-10-15 · **Última actualización:** 2026-10-15 · **Cambio:** actualiza con los PRs de R1 mergeados en `main` · **Versión:** 0.1.1-alpha.2 (`main`)

**Etapa: alpha.** Sirve como app de notas local para una persona. No sirve todavía para un equipo,
para contenido ni para datos de comercio. La siguiente etapa, **beta**, llega cuando R1 esté cerrado
y el equipo que construye Fossil lo use a diario en lugar de su app de notas ([`MILESTONES.md`](MILESTONES.md)).

## Números

| Qué | Valor | Fuente |
|---|---:|---|
| Releases cerrados | R0 de 8 | Milestones de GitHub |
| Avance de R1 (issues cerrados) | 28 de 35 | Conteo del 2026-10-15 tras merge de búsqueda, editor, shell e IA core |
| Funciones en `main` en [`FEATURES.md`](FEATURES.md) | 25 | Filas con estado `0.1` o `0.1 (núcleo)` |
| Funciones construidas, en revisión | 4 | Filas con estado `Revisión` |
| Tests de Rust | 66 | `git grep '#\[(tokio::)?test'` |
| Tests de TypeScript (Vitest) | 99 | `it(` y `test(` en `*.test.ts(x)` |
| Comandos IPC tipados | 23 | `collect_commands!` en `apps/desktop/src-tauri/src/lib.rs` |
| Instalador | 1.1 MB (límite 30 MB) | `scripts/perf.ps1`, línea base R0 |
| Arranque en frío | 0.2–0.6 s (límite 1.5 s) | `scripts/perf.ps1`, línea base R0 |
| RAM en reposo | ~158 MB (límite 200 MB) | `scripts/perf.ps1`, línea base R0 |
| Búsqueda en 10 000 páginas | < 50 ms p95 (límite 50 ms) | `crates/fossil-core/benches/search_10k.rs` |

## Por área

| Área | Estado | Funciona | Falta para cerrar su release |
|---|---|---|---|
| Espacios y almacenamiento | Funciona | Crear y abrir, recientes, SQLite con CRDT, copia en Markdown, adjuntos en el core | Imágenes en el editor (en revisión) |
| Editor | Funciona | Bloques básicos, avisos, tablas, separadores, menú `/`, atajos de Markdown, esquemas (`Tab`/plegado/pegado limpio), arrastrar bloques, conteo de palabras, guardado continuo | Imágenes en el editor (en revisión) |
| Enlaces y búsqueda | Funciona | Índice en background, búsqueda FTS5 con operadores (`tag:`, `type:`, `-`), pantalla global de búsqueda, `Ctrl+F` en página, `[[ ]]`, `#tags`, panel **Enlazada desde** y **Menciones sin enlace** | Publicar la versión que los incluye |
| Shell | Funciona | Ventana Mica sin destello blanco, sidebar, Hoy, ajustes, tema, densidad, idioma, paleta `Ctrl+K` y salto `Ctrl+P` | Pestañas, paneles divididos, captura rápida y bandeja |
| IA | Parcial | Router con respaldo y log de uso, almacén de claves, proveedores Anthropic/OpenAI/Gemini/Ollama y puente de CLIs locales en Rust | Merge del panel de chat y acciones sobre la selección (en revisión) |
| Exportar | Funciona | Markdown y PDF | — |
| Pruebas de extremo a extremo | En revisión | Runner e2e con WebDriver y checklist de release (en revisión) | Merge a `main` |
| Equipo, contenido, comercio, publicación | No empezado | — | R2 a R6 |

## Lo que no funciona todavía

- En la última versión publicada (`0.1.1-alpha.2`) aún no están publicadas la búsqueda, la paleta `Ctrl+K`, los enlaces `[[ ]]`, los esquemas ni la exportación a PDF (ya están en `main`).
- No hay tipos propios, campos, vistas ni tareas con fecha.
- El panel de chat de IA en la interfaz sigue en revisión antes de entrar a `main`.
- No hay sincronización ni nada de equipo: un Espacio es de una sola computadora.
- Editar el `.md` desde fuera de Fossil no cambia la página (solo exportación hasta R7).
- El instalador no está firmado; Windows SmartScreen pide confirmación.
- Solo Windows 11.

## Cómo se actualiza esta página

Al cerrar un release, al publicar una versión o cuando cambia un número medido. Cada fila de
"Números" dice de dónde sale; si no se puede medir, dice "sin medir", nunca un estimado sin marcar.
