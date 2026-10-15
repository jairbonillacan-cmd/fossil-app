# Spec R2: Proyectos, dependencias, flujos, planificación y Rastro

> **Estado:** Borrador — requiere aprobación del PO. · **Área:** `area:objects`, `area:tasks`, `area:views`, `area:ui`
> **Orden de ejecución:** `contrato de datos` (`r2-contract-fields`, `r2-contract-relations`, `r2-contract-tasks`) → `trabajo` (`r2-views-core`, `r2-projects`, `r2-dependencies`, `r2-workflows`, `r2-weekly`, `r2-templates`, `r2-context-project`, `r2-trail`) → `agente` (`r2-contract-tools`, `r2-ai-review`). Ninguna vista de proyecto, planificación o **Rastro** se construye antes de mergear los contratos de datos de R2.

## Qué y Por qué
- **Qué:** **Proyecto** modelado como composición de objetos existentes del grafo (descripción, estado, progreso, hitos, tareas y archivos), dependencias dirigidas sin ciclos, flujos de estados por **Tipo** con historial inmutable, planificación semanal y modo **Enfoque**, **Plantillas de Espacio** borrables, **Contexto de proyecto** y **Rastro** (`idea → decisión → tarea → entregable` con vínculos confirmados vs. inferidos).
- **Por qué:** Para que `Mi equipo` en `Acme` planifique y ejecute proyectos completos conectando notas de reunión, decisiones, tareas y entregables dentro del mismo modelo de objetos (ADR-0005), sin duplicar bases de datos ni perder la trazabilidad de por qué se construyó cada entregable.

## Capa de datos y consultas (Rust / SQLite en `crates/fossil-core`, sin UI)
- **Proyecto como composición de objetos existentes (`r2-projects`):**
  - Un **Proyecto** es una **Página** con el **Tipo** `project` cuyo cuerpo CRDT aloja la narrativa y descripción, y que compone mediante `object_relations` y `tasks_index` sus **Hitos** (`milestone`), **Tareas** (`task`, tanto páginas como bloques promovidos/vinculados), **Decisiones** (`decision`), **Reuniones** (`meeting`) y **Archivos** (`attachment`).
  - El progreso del proyecto y de cada hito (`progress_bp`: `0..=10000` puntos base) se calcula con un `rollup` incremental sobre las tareas vinculadas sin mantener contadores manuales desconectados.
- **Dependencias sin ciclos y bloqueos (`r2-dependencies`):**
  - Tabla `task_dependencies` con aristas dirigidas `blocker_id -> blocked_id` entre tareas o hitos.
  - Al insertar o editar una dependencia, Rust ejecuta detección de ciclos (DFS sobre el subgrafo alcanzable) y rechaza cualquier ciclo (`CoreError::DependencyCycleDetected` con la ruta de nodos implicados).
  - Un objeto tiene `is_blocked = true` mientras al menos un `blocker_id` activo no esté en categoría `Completed`; al completarse o borrarse lógicamente el bloqueador, Rust recalcula de forma incremental el estado de bloqueo de sus dependientes directos.
- **Flujos de estados por Tipo preservando historial (`r2-workflows`):**
  - Cada **Tipo** define en `type_workflows` sus estados agrupados en categorías canónicas (`Backlog`, `Unstarted`, `Started`, `Completed`, `Canceled`) y las transiciones válidas (`allowed_transitions_json`).
  - Todo cambio de estado se valida en Rust contra el flujo activo y escribe una fila inmutable en `object_state_history` (`object_id`, `type_key`, `from_state_id`, `to_state_id`, `changed_at_utc`). Renombrar o modificar estados del **Tipo** nunca borra ni corrompe el historial de transiciones previas.
- **Planificación semanal, Enfoque y Plantillas de Espacio (`r2-weekly`, `r2-templates`):**
  - `weekly_review_query` agrega en una sola consulta en Rust las capturas pendientes en **Bandeja**, tareas **Atrasadas**, tareas bloqueadas, hitos de los próximos 14 días y proyectos activos sin avances recientes; `focus_session_state` gestiona la sesión de **Enfoque** sobre una tarea o proyecto objetivo.
  - **Plantillas de Espacio (`r2-templates`):** paquetes declarativos locales (`software`, `estudio`, `agencia`, `personal`) que instancian **Tipos**, flujos de estados, **Vistas** guardadas y un proyecto de ejemplo de `Acme` etiquetado con `sample_batch_id`. El comando `workspace_purge_sample_batch` elimina limpiamente todos los objetos de muestra no editados por la persona usuaria.
- **Contexto de proyecto y Rastro (`r2-context-project`, `r2-trail`):**
  - **Contexto de proyecto (`project_context_query`):** amplía `r1-context-lite` reuniendo decisiones, tareas abiertas/bloqueadas, reuniones, archivos y referencias del proyecto, indicando el motivo de cada elemento (`DirectRelation`, `SharedMilestone`, `BlockMention`).
  - **Rastro (`r2-trail`):** tabla `trail_edges` que modela cadenas `Idea -> Decision -> Task -> Deliverable` (con soporte de `object_id` y `block_id`). Cada arista distingue `status`: `Confirmed` (creada o validada por el usuario) frente a `Inferred` (sugerida determinísticamente por Rust al detectar `[[enlaces]]`, referencias `((blockId))` o promoción de tarea desde una nota de decisión/reunión), con comandos para confirmar o descartar sin ruido.

## Capa de vistas React (`@fossil/desktop`, sin lógica de grafos ni validación)
- **Espacio de Proyecto, dependencias y flujos (`r2-projects`, `r2-dependencies`, `r2-workflows`):** cabecera de **Proyecto** con progreso por hito, selector de estado gobernado por el flujo del **Tipo**, indicador de tareas bloqueadas con selector de dependencias y pestañas reutilizando la fuente única de **Vistas** (`Tabla`, `Tablero`, `Lista`, `Calendario`).
- **Revisión semanal, modo Enfoque y Plantillas (`r2-weekly`, `r2-templates`):** asistente de **Revisión semanal** (**Bandeja** → **Atrasado** → **Hitos** → **Prioridades de la semana**), vista limpia de **Enfoque** centrada en la tarea activa con sus notas de apoyo, y selector inicial de **Plantillas de Espacio** con botón de un clic para borrar los datos de muestra.
- **Panel de Contexto de proyecto y visor de Rastro (`r2-context-project`, `r2-trail`):** panel contextual con decisiones, reuniones y referencias del proyecto, y componente visual de **Rastro** (`Idea → Decisión → Tarea → Entregable`) que diferencia eslabones confirmados (trazo continuo) de inferidos (trazo punteado con acciones **Confirmar** / **Descartar**).

## Criterios de aceptación, fuera de alcance y riesgos
- Un proyecto de prueba en `Acme` se recorre desde la captura en **Bandeja**, pasando por una **Decisión**, la creación y completado de **Tareas** e **Hitos** hasta el **Entregable**, actualizando el progreso del proyecto y mostrando la cadena completa en el **Rastro**.
- Cualquier intento de crear un ciclo de dependencias (`A -> B -> C -> A`) es rechazado en Rust en < 5 ms devolviendo la ruta del ciclo; las transiciones de estado inválidas según el flujo del **Tipo** se rechazan antes de persistir y las válidas quedan registradas en `object_state_history`.
- Aplicar cualquiera de las 4 **Plantillas de Espacio** (`software`, `estudio`, `agencia`, `personal`) y ejecutar **Borrar datos de ejemplo** elimina el 100 % de los objetos de muestra sin tocar páginas ni cambios creados por el usuario.
- **Fuera de alcance:** diagramas de Gantt multi-recurso y ruta crítica financiera (R3), aprobaciones externas de cliente en portal (R4) y predicción de retrasos con IA (R5). **Riesgos:** exceso de eslabones inferidos en el **Rastro** (mitigado limitando inferencias a menciones/promociones explícitas y guardando descartes en `trail_edges`).

## Contrato propuesto (SQLite en `crates/fossil-core` y `tauri-specta`)
```sql
CREATE TABLE task_dependencies (edge_id TEXT PRIMARY KEY, blocker_id TEXT NOT NULL, blocked_id TEXT NOT NULL, created_at_utc TEXT NOT NULL, UNIQUE (blocker_id, blocked_id));
CREATE TABLE type_workflows (type_key TEXT PRIMARY KEY, states_json TEXT NOT NULL, allowed_transitions_json TEXT NOT NULL, updated_at_utc TEXT NOT NULL);
CREATE TABLE object_state_history (entry_id TEXT PRIMARY KEY, object_id TEXT NOT NULL, type_key TEXT NOT NULL, from_state_id TEXT, to_state_id TEXT NOT NULL, changed_at_utc TEXT NOT NULL);
CREATE TABLE trail_edges (edge_id TEXT PRIMARY KEY, from_object_id TEXT NOT NULL, from_block_id TEXT, to_object_id TEXT NOT NULL, to_block_id TEXT, stage_kind TEXT NOT NULL, status TEXT NOT NULL, reason TEXT NOT NULL, updated_at_utc TEXT NOT NULL);
CREATE TABLE template_sample_objects (sample_batch_id TEXT NOT NULL, object_id TEXT NOT NULL, user_modified INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (sample_batch_id, object_id));
```
```rust
pub enum WorkflowCategory { Backlog, Unstarted, Started, Completed, Canceled }
pub enum TrailStageKind { IdeaToDecision, DecisionToTask, TaskToDeliverable }
pub enum TrailEdgeStatus { Confirmed, Inferred, Dismissed }
pub enum WorkspaceTemplateKind { Software, Studio, Agency, Personal }
pub struct ProjectOverview { pub project_id: String, pub state_id: String, pub progress_bp: u32, pub total_tasks: u32, pub completed_tasks: u32, pub blocked_tasks: u32 }
pub struct TrailEdgeItem { pub edge_id: String, pub from_object_id: String, pub to_object_id: String, pub stage_kind: TrailStageKind, pub status: TrailEdgeStatus, pub reason: String }
// Comandos IPC (apps/desktop/src/bindings.ts):
// project_get_overview(project_id: String) -> Result<ProjectOverview, CoreError>
// dependency_add(blocker_id: String, blocked_id: String) -> Result<(), CoreError>
// workflow_transition_object(object_id: String, type_key: String, to_state_id: String) -> Result<(), CoreError>
// weekly_review_query(now_utc: String, viewer_tz: String) -> Result<WeeklyReviewSnapshot, CoreError>
// workspace_apply_template(kind: WorkspaceTemplateKind) -> Result<String, CoreError>
// workspace_purge_sample_batch(sample_batch_id: String) -> Result<u32, CoreError>
// project_context_query(project_id: String) -> Result<ProjectContextBundle, CoreError>
// trail_list_for_object(object_id: String) -> Result<Vec<TrailEdgeItem>, CoreError>
// trail_set_edge_status(edge_id: String, status: TrailEdgeStatus) -> Result<TrailEdgeItem, CoreError>
```
