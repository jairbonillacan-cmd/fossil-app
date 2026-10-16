# Releases y riesgos

> **Última revisión:** 2026-10-15 · **Última actualización:** 2026-10-15 · **Cambio:** R1 se parte en R1 núcleo y R1.5 Adopción; criterios de cierre de R1 y R2 ([`backlog/R1-R2-recomendaciones.md`](backlog/R1-R2-recomendaciones.md))

Cada release es una rebanada vertical: sale algo **instalable que el equipo usa a diario**, nunca
una fase de "solo backend". Las funciones de cada release están en [`FEATURES.md`](FEATURES.md);
la versión pública, sin fechas ni detalles internos, es [`../ROADMAP.md`](../ROADMAP.md). Los
releases son milestones de GitHub (`R0`…`R7`, `R1.5`, `Futuro`) y sus tareas, issues.

## Releases

| Release | Tema | Duración estimada | Está listo cuando… | Estado |
|---|---|---|---|---|
| **R0 Fundaciones** | Monorepo, docs, protocolo, CI y perf, instalador NSIS, design tokens | 1–2 semanas | Un agente nuevo sigue `AGENTS.md` y abre un PR válido sin ayuda | Cerrado 2026-10-14 (`docs/retro/R0.md`) |
| **R1 Espacio** (núcleo) | Páginas, editor, bitácora, búsqueda, `Ctrl+K`, chat de IA con router y CLIs locales; confianza: estado de guardado, respaldos y restauración, historial local de páginas, editor intensivo, benchmarks reproducibles | 5–7 semanas | El equipo usa Fossil a diario en lugar de su app de notas ([criterios](#criterios-de-cierre)) | En curso |
| **R1.5 Adopción** | Importar carpetas Markdown, primer inicio, Contexto relacionado, adjuntos, accesibilidad, ranking de búsqueda, renombrar seguro, paleta unificada, bloques de código, matemáticas y diagramas, tipografía, modo Markdown, favoritos y papelera | 3–4 semanas, en paralelo al final de R1 | Alguien que llega con sus notas en Markdown las importa, entiende la app en el primer inicio y la usa sin ratón | En curso |
| **R2 Tipos y tareas** | Tipos, vistas, tareas, recordatorios, proyectos y planificación semanal, servidor y cliente MCP, agente con herramientas | 5–7 semanas | El equipo planea su semana y el propio proyecto Fossil dentro de Fossil ([criterios](#criterios-de-cierre)) | — |
| **R3 Equipo** | Supabase + Hocuspocus, cuentas, roles, presencia, comentarios, historial | 6–8 semanas | **v0.3:** de 3 a 5 personas de un equipo piloto colaboran en vivo | — |
| **R4 Contenido** | Marca, campañas, publicaciones, previsualización, parrillas, aprobaciones, portal, biblioteca de creativos, voz de marca | 8–10 semanas | El calendario del mes de un equipo piloto se arma y aprueba en Fossil | — |
| **R5 Comercio y datos** | Conectores de tienda, anuncios y GA4; Resumen, Rentabilidad, atribución, Creativos, cohortes, KPIs, alertas, reportes, agente analista, automatizaciones | 8–10 semanas | El reporte mensual y el panel diario salen de Fossil | — |
| **R6 Publicación** | Publicación programada, mejor hora, bandeja de comentarios, enlaces con seguimiento, más redes | 6–8 semanas | Las publicaciones aprobadas salen solas | — |
| **R7 v1.0** | Firma de código, actualizaciones estable y beta, onboarding, E2EE, extensiones v1, reuniones y voz, pizarras, copia en Markdown bidireccional | 5–7 semanas | Cualquier persona descarga, instala y entiende Fossil | — |

### Criterios de cierre

Además de [Cierre de un release](#cierre-de-un-release), estos releases cierran solo si:

**R1 núcleo**
- Nada confirmado como guardado se pierde tras cierre forzado, IPC fallido o reinicio.
- Un respaldo restaura SQLite, `attachments/` y la configuración, y una página se recupera sola.
- `search_10k` no empeora.
- El editor con documentos grandes pasa las regresiones de undo/redo, pegado, sangría y arrastre.
- El changelog describe solo lo que trae el instalador.
- El equipo usa Fossil 14 días seguidos.

**R1.5 Adopción**
- Una carpeta de 1 000 archivos Markdown se importa con reporte y se puede revertir completa.
- Renombrar, archivar o mover nunca deja enlaces rotos en silencio.
- El test automático de accesibilidad pasa y toda acción principal se hace sin ratón.

**R2**
- Una tarea creada en una nota aparece en Hoy y en todas sus vistas sin duplicarse.
- Un proyecto de prueba se completa de la captura a la revisión.
- Varios Tipos en una página no chocan.
- Tabla, tablero, lista y calendario coinciden en tiempo real.
- Recordatorios y recurrencias sobreviven reinicios y cambios de zona horaria.
- Agente y MCP respetan permisos en Rust, con confirmación, auditoría y reversión.
- Consulta, serialización y render se miden por separado con 5 000 objetos.

Las líneas de trabajo se solapan: mientras un carril cierra el núcleo de un release, otro adelanta
el siguiente, siempre sobre un contrato ya mergeado ([`PROTOCOL.md`](PROTOCOL.md)).

**Ritmo estimado**, con 2–3 agentes en paralelo y un mantenedor que dirige y revisa: v0.3 en unos
4–5 meses y v1.0 en unos 11–14 meses desde R0. Se reevalúa al cerrar cada release, en su retro.

## Cómo hacemos alcanzable un alcance tan grande

1. **Rebanadas verticales.** Cada 6–8 semanas sale algo instalable y usado.
2. **Uso diario desde R1.** El equipo que construye Fossil lo usa; un equipo piloto entra en R3.
3. **Reutilizar antes de construir.** Ninguna pieza de infraestructura se escribe desde cero si
   existe una abierta y probada: Hocuspocus para sync, Supabase para cuentas y Postgres, APIs
   oficiales en modo de acceso propio para redes y anuncios, los datos que la tienda, UTM y GA4 ya
   dan para atribución. La publicación (API unificada o APIs directas) se decide en un ADR en R6.
4. **Lo difícil se pospone, no se borra.** Ver [Diferidos](#diferidos).
5. **La revisión es el cuello de botella, no la escritura.** Máximo 3 constructores activos y PRs
   de ≤400 líneas, para revisarlos en minutos.
6. **Spikes de 1–2 días antes de lo arriesgado:** editor + Yjs, copia en Markdown, tamaño de DuckDB,
   Hocuspocus con auth de Supabase.
7. **Trámites largos en paralelo desde R1:** verificación de negocio en Meta y TikTok, token de
   desarrollador de Google Ads, certificado de firma de código, dominio. Tardan semanas y no
   dependen del código.

## Riesgos

| Riesgo | Mitigación |
|---|---|
| Editor + Yjs + outliner es lo más difícil | Spike en la primera semana de R1; `y-prosemirror` y extensiones probadas; tests de propiedades |
| Copia en Markdown ↔ CRDT con conflictos | Solo exportación hasta R7 |
| Revisión de apps de Meta y TikTok | Para cuentas propias basta el modo de desarrollo o el acceso estándar; empezar el trámite en R1 |
| Tamaño y RAM se disparan | `perf.yml` mide cada PR de código y falla si se pasa un presupuesto; paquetes opcionales; carga perezosa |
| Agentes chocando entre sí | Contratos primero, carriles por archivo, worktrees, límite de trabajo en curso |
| Tiempo de revisión | PRs ≤400 líneas, revisor distinto del autor, checklist de [`DOD.md`](DOD.md) |
| Crece el alcance | Este catálogo es el backlog; algo nuevo entra solo desplazando otra cosa del release |
| Un proveedor cambia o restringe su CLI de IA | El adaptador está aislado en `fossil-bridge`; el router cae a la clave de API; nunca se reutilizan tokens |
| Fuga de datos hacia la IA | Vista previa del contexto que se envía, política de proveedores por Espacio, superficies locales solo en 127.0.0.1 con token rotativo |
| Windows SmartScreen sin firma | Firma de código en R7; antes, instaladores solo para el equipo |

## Diferidos

Fuera de los releases actuales, no eliminados.

| Función | Release |
|---|---|
| E2EE, copia en Markdown bidireccional, extensiones, reuniones y voz, pizarras | R7 |
| Píxel propio, multitoque, mezcla de medios, benchmarks | Futuro |
| Mensajes directos, flujos, competidores | Futuro |
| Tarjetas de estudio | Futuro |
| Sync en red local | Futuro |
| Extensiones WebAssembly | Futuro |
| Publicar páginas a la web | Futuro |
| App móvil compañera | Futuro |

## Cierre de un release

1. Todos los issues del milestone cerrados o movidos, con motivo.
2. Instalador generado en CI e instalado por el mantenedor.
3. Demo grabada y retrospectiva en `docs/retro/R<n>.md`: qué salió bien, qué no, qué ajustamos.
4. Se actualizan esta página, [`FEATURES.md`](FEATURES.md), [`STATUS.md`](STATUS.md) y `ROADMAP.md`,
   y se preparan las specs e issues del siguiente release.
