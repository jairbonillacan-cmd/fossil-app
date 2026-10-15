# Estado de Fossil

> **Última revisión:** 2026-10-15 · **Última actualización:** 2026-10-15 · **Cambio:** primera versión · **Versión:** 0.1.1-alpha.2

**Etapa: alpha.** Sirve como app de notas local para una persona. No sirve todavía para un equipo,
para contenido ni para datos de comercio. La siguiente etapa, **beta**, llega cuando R1 esté cerrado
y el equipo que construye Fossil lo use a diario en lugar de su app de notas ([`MILESTONES.md`](MILESTONES.md)).

## Números

| Qué | Valor | Fuente |
|---|---:|---|
| Releases cerrados | R0 de 8 | Milestones de GitHub |
| Avance de R1 (issues cerrados) | 14 de 32 | Conteo del 2026-10-15, antes de abrir el repositorio |
| Funciones lanzadas en [`FEATURES.md`](FEATURES.md) | 10 | Filas con estado `0.1` |
| Funciones construidas, en revisión | 12 | Filas con estado `Revisión` |
| Tests de Rust | 58 | `git grep '#\[(tokio::)?test'` |
| Tests de TypeScript (Vitest) | 77 | `it(` y `test(` en `*.test.ts(x)` |
| Comandos IPC tipados | 23 | `collect_commands!` en `apps/desktop/src-tauri/src/lib.rs` |
| Instalador | 1.1 MB (límite 30 MB) | `scripts/perf.ps1`, línea base R0 |
| Arranque en frío | 0.2–0.6 s (límite 1.5 s) | `scripts/perf.ps1`, línea base R0 |
| RAM en reposo | ~158 MB (límite 200 MB) | `scripts/perf.ps1`, línea base R0 |
| Búsqueda en 10 000 páginas | sin medir (límite 50 ms) | bench `search_10k`, en revisión |

## Por área

| Área | Estado | Funciona | Falta para cerrar su release |
|---|---|---|---|
| Espacios y almacenamiento | Funciona | Crear y abrir, recientes, SQLite con CRDT, copia en Markdown, adjuntos en el core | Imágenes en el editor |
| Editor | Funciona | Bloques básicos, menú `/`, atajos de Markdown, guardado continuo | Esquemas, tablas, avisos, arrastrar bloques (en revisión) |
| Enlaces y búsqueda | En revisión | Índice de enlaces y etiquetas en el core | Merge de búsqueda FTS5, `[[ ]]`, `#tags`, Enlazada desde, búsqueda global |
| Shell | Funciona | Ventana Mica, sidebar, Hoy, ajustes, tema, densidad, idioma | Paleta `Ctrl+K` (en revisión), pestañas, paneles, captura rápida, bandeja |
| IA | En revisión | Contrato del router, almacén de claves, proveedor Anthropic | Merge de proveedores, router y puente; panel de chat |
| Exportar | Parcial | Markdown | PDF |
| Pruebas de extremo a extremo | No empezado | — | e2e con WebDriver y checklist de release |
| Equipo, contenido, comercio, publicación | No empezado | — | R2 a R6 |

## Lo que no funciona todavía

- No hay búsqueda, enlaces entre páginas ni etiquetas en la versión publicada.
- No hay tipos propios, campos, vistas ni tareas con fecha.
- No hay IA en la interfaz.
- No hay sincronización ni nada de equipo: un Espacio es de una sola computadora.
- Editar el `.md` desde fuera de Fossil no cambia la página (solo exportación hasta R7).
- El instalador no está firmado; Windows SmartScreen pide confirmación.
- Solo Windows 11.

## Cómo se actualiza esta página

Al cerrar un release, al publicar una versión o cuando cambia un número medido. Cada fila de
"Números" dice de dónde sale; si no se puede medir, dice "sin medir", nunca un estimado sin marcar.
