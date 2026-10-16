**Aceptado por el PO el 2026-10-15.** Propuesta a partir de la revisión de producto "Recomendaciones para R1 y R2". Se materializa por olas: primero las filas que no dependen de una spec pendiente; el resto, cuando el PO apruebe su spec. El estado vive en GitHub, no aquí.

# Backlog R1 + R2: recomendaciones de producto (para materializar como GitHub Issues)

> **Lo usa el orquestador para crear los issues; cada fila se materializa una sola vez.**
> - Antes de crear, verifica con `gh issue list --state all --limit 200` que no exista ya. Si existe, **amplía** sus criterios de aceptación con un comentario en lugar de duplicarlo (columna "Existe").
> - Labels: `type:*`, `area:*`, `size:*`; `status:ready` solo si su contrato ya está mergeado; si no, sin status.
> - Milestone: el de la sección. "Depende de": sustituye las claves por el número real.
> - "Contexto a leer": `AGENTS.md`, la spec indicada y `docs/modules/<área>.md`.
> - Nada se elimina del roadmap: las prioridades ordenan, no recortan. P0 = condición de confianza del release; P1 = alto impacto diario; P2 = complemento paralelo o final.
> - Regla de alcance (`MILESTONES.md`, Riesgos): lo que entra a R1 desplaza tiempo. Por eso R1 se parte en **R1 núcleo** (cierra R1) y **R1.5 Adopción** (milestone nuevo, aprobado por el PO el 2026-10-15).

## 0. Specs nuevas o ampliadas (antes de cualquier código)

| Clave | Spec | Qué cubre | Autor sugerido |
|---|---|---|---|
| s-r1-trust | `docs/specs/r1-trust.md` (nueva) | Restore (snapshots de SQLite + adjuntos + config), historial local de páginas, estado Guardado/Guardando/Error, ida y vuelta del espejo Markdown | antigravity-c |
| s-r1-import | `docs/specs/r1-import-adoption.md` (nueva) | Importador básico de carpetas Markdown (frontmatter, imágenes, `[[enlaces]]`), vista de conflictos y reversión, primer inicio con Espacio de ejemplo, Bandeja universal | antigravity-c |
| s-r1-shell | `docs/specs/r1-shell-ux.md` (ampliar) | Navegación recuperable (pestañas, paneles, scroll, atrás/adelante), paleta unificada, accesibilidad y mapa de atajos, Contexto relacionado | antigravity |
| s-r1-ui | `docs/specs/r1-interface-design.md` (nueva) | Diseño de la interfaz: barra lateral en árbol, pestañas, encabezado de página con menú `⋯`, barra de desplazamiento discreta por tema, imágenes en el editor, estados vacíos y de error; claro y oscuro con capturas | zcode-a |
| s-r2-types | `docs/specs/r2-types-views.md` (ampliar PR de specs R2) | Campos con id estable y namespace por Tipo, relaciones bidireccionales con cardinalidad, una fuente de verdad para todas las vistas, filtros AND/OR y vistas guardadas, virtualización con 5 000 objetos, validación, decimal exacto y moneda ISO, acciones masivas | antigravity-search |
| s-r2-tasks | `docs/specs/r2-tasks-reminders.md` (ampliar) | Identidad de tarea y promoción de bloque ↔ página, fechas sin hora / programada / vencimiento / aviso con zona horaria, recurrencias, notificaciones sin duplicados tras reinicio o suspensión | antigravity-search |
| s-r2-agent | `docs/specs/r2-agent-tools.md` + `r2-mcp.md` (ampliar) | Un solo registro de herramientas para UI, paleta y MCP con permisos validados en Rust; plan de cambios revisable antes de escribir; historial de operaciones del agente; costo, contexto y advertencia de envío externo | antigravity-search |
| s-r2-projects | `docs/specs/r2-projects-planning.md` (nueva) | Proyecto como composición de objetos (estado, progreso, hitos, tareas, archivos), dependencias y bloqueos, flujos de estados por Tipo, planificación semanal y Enfoque, plantillas de Espacio, Contexto de proyecto, Rastro (idea → decisión → tarea → entregable) | antigravity-search |

## Milestone "R1 Espacio" (núcleo: cierra R1)

| Clave | Título | Tipo · área · tamaño | Prioridad | Depende de | Existe |
|---|---|---|---|---|---|
| r1-save-status | Indicador Guardado / Guardando / Error ligado al transporte Yjs; nunca muestra "Guardado" si un delta falló | feat · editor · S | P0 | s-r1-trust | Amplía lo hecho en #48 |
| r1-save-chaos | Pruebas de cierre forzado, IPC fallido y reinicio sin pérdida de cambios confirmados | chore · storage · M | P0 | r1-save-status | — |
| r1-contract-restore | Contrato: snapshots, restauración de página / archivo / Espacio, versiones locales de página | contract · storage · M | P0 | s-r1-trust | — |
| r1-snapshots | Snapshots consistentes de SQLite, `attachments/` y config sin sobrescribir el original | feat · storage · M | P0 | r1-contract-restore | — |
| r1-restore-ui | Asistente de restauración (página, archivo o Espacio completo) | feat · ui · M | P0 | r1-snapshots | — |
| r1-page-history | Historial local de páginas: versiones tras operaciones relevantes, comparar y restaurar sin romper referencias | feat · storage · M | P0 | r1-contract-restore | — (R3 sigue con el historial de equipo) |
| r1-sqlite-tx | Transacciones, `busy_timeout`, migraciones FTS | bug · storage · M | P0 | — | #56 (PR abierto) |
| r1-editor-heavy | Editor intensivo: undo/redo, selección múltiple, cortar/pegar, mover ramas, regresiones de HTML pegado sin alterar IDs | bug · editor · M | P0 | — | — |
| r1-mirror-roundtrip | Exportar y reimportar un corpus de prueba conserva el contenido; reporte de elementos no compatibles; documentar límites de edición externa | chore · storage · M | P0 | r1-md-import | — |
| r1-perf-repro | Benchmarks reproducibles: corpus grandes, arranque repetido, scroll largo, importación; percentiles y hardware declarado | perf · infra · M | P0 | — | Amplía `scripts/perf.ps1` |
| r1-release-trace | Separar "en main / en revisión / publicado" en changelog y checklist; publicar la versión con lo ya terminado | chore · infra · S | P1 | — | — |
| r1-capture-inbox | Captura global + bandeja del sistema con destino Bandeja universal (texto, enlace, archivo); funciona con Fossil cerrado; feedback de dónde se guardó; error si Windows retiene el atajo | feat · os · M | P1 | s-r1-import | #9 (ampliar criterios) |
| r1-tabs-restore | Pestañas y paneles con sesión recuperable al reiniciar | feat · ui · M | P1 | s-r1-shell | #29 (ampliar criterios) |
| r1-ai-confirm | IA en selección y chat: proveedor y modelo visibles, contexto enviado, consumo estimado, confirmar antes de insertar; cancelar no modifica la página | feat · ai · M | P1 | — | Amplía #14 |

## Milestone "R1.5 Adopción" (nuevo, aprobado por el PO)

| Clave | Título | Tipo · área · tamaño | Prioridad | Depende de |
|---|---|---|---|---|
| r1-contract-import | Contrato: importación con vista previa, reporte y reversión | contract · storage · S | P0 | s-r1-import |
| r1-md-import | Importador básico de carpetas Markdown con frontmatter, imágenes y enlaces; prueba con 1 000 archivos | feat · storage · M | P0 | r1-contract-import |
| r1-import-conflicts | Vista de conflictos (títulos repetidos, rutas inválidas, recursos faltantes) y deshacer toda la importación | feat · ui · M | P2 | r1-md-import |
| r1-onboarding | Primer inicio en tres pasos y Espacio de ejemplo eliminable | feat · ui · S | P1 | — |
| r1-context-lite | Panel de Contexto relacionado sin IA: enlaces, menciones, títulos parecidos, etiquetas y actividad, con el porqué de cada sugerencia | feat · ui · M | P1 | — |
| r1-attachments | Explorador de adjuntos: tamaños, páginas que los usan, huérfanos; borrar una página nunca borra un adjunto referenciado | feat · storage · M | P1 | — |
| r1-a11y | Mapa de atajos, foco visible, navegación sin ratón, etiquetas accesibles, reducir movimiento; test automático de accesibilidad | feat · ui · M | P1 | — |
| r1-search-rank | Ranking por título, enlaces y recencia; filtros guardados; sin empeorar `search_10k` | feat · storage · M | P1 | — |
| r1-safe-rename | Renombrar, archivar, restaurar o mover nunca deja enlaces rotos en silencio; resolver títulos ambiguos | bug · storage · M | P1 | — |
| r1-palette-unify | Nombres de comando consistentes, búsqueda tolerante a errores y acciones recientes en `Ctrl+K` / `Ctrl+P` | feat · ui · S | P1 | — |
| r1-code-blocks | Bloques de código avanzados: resaltado por lenguaje, título, copiar, números y resaltado de línea, diferencias, formateo JSON/SQL; carga diferida | feat · editor · M | P1 | — |
| r1-math-diagrams | Matemáticas LaTeX en línea y en bloque, diagramas en texto y gráficas desde tablas; carga diferida y errores legibles | feat · editor · M | P1 | — |
| r1-typography | Tipografía y lectura: fuente sin patines, con patines o mono; tamaño; lectura centrada o ancho completo | feat · ui · S | P1 | — |
| r1-markdown-mode | Modo Markdown, buscar y reemplazar `Ctrl+H`, índice de encabezados y presentación a pantalla completa | feat · editor · M | P1 | — |
| r1-favorites-trash | Favoritos, recientes, `@hoy` y papelera del Espacio con restaurar | feat · ui · M | P1 | — |
| r1-ui-design | Diseño de la interfaz completa (barra lateral, barra de pestañas, encabezado de página, editor, ajustes) en claro y oscuro, blanco y negro, según `docs/DESIGN.md`; mapa de pantallas y capturas de referencia antes de implementar | design · ui · M | P1 | s-r1-ui |
| r1-scrollbar | Barra de desplazamiento discreta: blanca en tema oscuro y negra en claro, de muy baja opacidad para que casi no se note; pegada al borde derecho de la ventana (no del contenido centrado); visible al pasar el cursor o al desplazar | feat · ui · S | P1 | r1-ui-design |
| r1-page-header | Encabezado de página: título siempre legible (sin recortes ni solaparse con botones, varias líneas o elipsis con tooltip); acciones secundarias (exportar, copiar enlace, historial, etc.) agrupadas en un menú de tres puntos `⋯` anclado a la derecha, con teclado y etiquetas accesibles | feat · ui · M | P1 | r1-ui-design |
| r1-tabs-ui | Barra de pestañas: pestañas fijas, cerrar, reordenar arrastrando, desbordamiento con desplazamiento, botón `+`, atrás/adelante; la restauración de sesión sigue en `r1-tabs-restore` | feat · ui · M | P1 | r1-ui-design |
| r1-images | Imágenes en el editor: pegar, arrastrar o insertar desde `/`; guardado en `attachments/`; redimensionar, alinear, pie de foto, texto alternativo, vista ampliada; carga diferida y sin perder la imagen al mover o duplicar la página | feat · editor · M | P1 | r1-attachments |
| r1-sidebar-tree | Barra lateral como árbol: carpetas y páginas con iconos coherentes, arrastrar para mover, expandir/contraer recordado, página activa resaltada, búsqueda `Ctrl+P` arriba | feat · ui · M | P1 | r1-ui-design |

> **Decisión del PO (2026-10-15):** R1 se parte en R1 núcleo + R1.5 Adopción. Bloques de código, matemáticas y diagramas, tipografía, modo Markdown y favoritos/papelera pasan a R1.5; en `ROADMAP.md` siguen visibles en "En curso".

## Milestone "R2 Tipos y tareas"

Orden: **contrato de datos → trabajo completo → agente**. Ninguna vista se construye antes de que su contrato esté mergeado.

| Clave | Título | Tipo · área · tamaño | Prioridad | Depende de |
|---|---|---|---|---|
| r2-contract-fields | Contrato: campos con id estable, namespace por Tipo y migraciones | contract · objects · M | P0 | s-r2-types |
| r2-contract-relations | Contrato: relaciones bidireccionales, cardinalidad, borrado lógico, rollups incrementales | contract · objects · M | P0 | r2-contract-fields |
| r2-contract-tasks | Contrato: identidad de tarea, promoción bloque ↔ página, modelo de fechas y zona horaria | contract · tasks · M | P0 | s-r2-tasks |
| r2-contract-tools | Contrato: registro único de herramientas, permisos en Rust, plan de cambios | contract · ai · M | P0 | s-r2-agent |
| r2-views-core | Una fuente de verdad para tabla, tablero, lista y calendario | feat · views · M | P0 | r2-contract-relations |
| r2-views-filters | Filtros AND/OR, orden, agrupación y vistas guardadas independientes | feat · views · M | P0 | r2-views-core |
| r2-views-perf | Virtualización y benchmark de 5 000 objetos (consulta, serialización y render por separado) | perf · views · M | P0 | r2-views-core |
| r2-money | Decimal exacto, moneda ISO, nulos y orden de evaluación de fórmulas | feat · objects · S | P1 | r2-contract-fields |
| r2-validation | Reglas de campo: requerido, rangos, referencias, estados válidos | feat · objects · S | P2 | r2-contract-fields |
| r2-universal-tasks | Tareas desde casillas, selección o página con vínculo al bloque de origen | feat · tasks · M | P0 | r2-contract-tasks |
| r2-recurring | Tareas recurrentes sin duplicados tras reinicio y con cambios de horario | feat · tasks · M | P1 | r2-universal-tasks |
| r2-notifications | Notificaciones de Windows fiables: reintentos, sin duplicados, posponer/completar | feat · os · M | P1 | r2-contract-tasks |
| r2-projects | Proyecto completo: descripción, estado, progreso, hitos, tareas, archivos | feat · objects · M | P0 | s-r2-projects, r2-views-core |
| r2-dependencies | Dependencias, bloqueos e hitos; impedir ciclos | feat · tasks · M | P1 | r2-projects |
| r2-workflows | Estados y transiciones por Tipo, preservando historial | feat · objects · M | P1 | r2-contract-fields |
| r2-weekly | Bandeja, Hoy, Próximo, Atrasado, revisión semanal y modo Enfoque | feat · tasks · M | P1 | r2-universal-tasks |
| r2-templates | Plantillas de Espacio (software, estudio, agencia, personal) borrables | feat · objects · S | P1 | r2-projects |
| r2-lists-collections | Listas guardadas vs. Colecciones con el porqué de cada elemento | feat · views · S | P1 | r2-views-filters |
| r2-bulk | Acciones masivas con vista previa, resultado parcial y reversión | feat · views · M | P2 | r2-views-filters |
| r2-import-full | Importación completa de exportaciones HTML/CSV de otras apps de notas, con reporte | feat · storage · M | P1 | r1-md-import |
| r2-graph | Grafo local y global con filtros, rutas entre páginas y acciones | feat · ui · M | P1 | r2-contract-relations |
| r2-context-project | Contexto de proyecto: decisiones, tareas, reuniones y referencias | feat · ui · M | P1 | r1-context-lite, r2-projects |
| r2-trail | Rastro inicial idea → decisión → tarea → entregable; inferido vs. confirmado | feat · objects · M | P1 | r2-projects |
| r2-mcp-secure | MCP sobre el registro único: límites de entrada y contenido no confiable aislado | feat · mcp · M | P0 | r2-contract-tools |
| r2-ai-review | Plan de cambios del agente: objetos afectados, diferencias, modelo, cancelar y deshacer | feat · ai · M | P0 | r2-contract-tools |
| r2-agent-log | Historial de operaciones del agente sin secretos | feat · ai · S | P1 | r2-ai-review |
| r2-ai-cost | Contexto, proveedor, topes de tokens y gasto, aviso de envío externo | feat · ai · S | P1 | r2-contract-tools |

## Criterios de cierre propuestos

**R1:** nada confirmado como guardado se pierde tras cierre forzado, IPC fallido o reinicio · un respaldo restaura SQLite, adjuntos y config, y una página se recupera sola · `search_10k` no empeora · el editor con documentos grandes pasa regresiones de undo/redo, pegado, sangría y arrastre · el changelog describe solo lo que trae el instalador · el equipo usa Fossil 14 días.

**R2:** una tarea creada en una nota aparece en Hoy y en todas sus vistas sin duplicarse · un proyecto de prueba se completa de la captura a la revisión · varios Tipos en una página no chocan · tabla, tablero, lista y calendario coinciden en tiempo real · recordatorios y recurrencias sobreviven reinicios y zona horaria · agente y MCP respetan permisos en Rust con confirmación, auditoría y reversión · consulta, serialización y render se miden por separado con 5 000 objetos.
