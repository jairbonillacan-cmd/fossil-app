# Spec R2: Tareas, bandeja y recordatorios

> **Estado:** Borrador — requiere aprobación del PO. · **Área:** `area:tasks`, `area:os`, `area:storage`, `area:ui`
> **Orden de ejecución:** `contrato de datos` (`r2-contract-tasks`) → `trabajo` (`r2-universal-tasks`, `r2-recurring`, `r2-notifications`, `r2-weekly`) → `agente` (`r2-contract-tools`, programación y consulta de tareas por agente y MCP). Ninguna vista React se construye antes de mergear `r2-contract-tasks`.

## Qué y Por qué
- **Qué:** Identidad única e inmutable de tarea con promoción bidireccional bloque ↔ **Página** conservando `blockId`, modelo de cuatro fechas (`sin hora`, `programada`, `vencimiento`, `aviso`) con zona horaria IANA, recurrencias idempotentes y recordatorios en notificaciones nativas de Windows (`fossil-os`) sin duplicados tras reinicio o suspensión.
- **Por qué:** Para que una tarea anotada durante una reunión o en la **Bitácora** de `Mi equipo` en `Acme` aparezca en **Hoy** y en todas sus **Vistas** sin duplicarse, pueda crecer a **Página** completa sin perder el vínculo con su bloque de origen y dispare avisos fiables ante cambios de horario o reinicios del sistema.

## Capa de datos y consultas (Rust / SQLite en `crates/fossil-core` y `crates/fossil-os`, sin UI)
- **Identidad de tarea y promoción bloque ↔ página (`r2-contract-tasks`, `r2-universal-tasks`):**
  - Toda tarea recibe al crearse un `task_id` estable (ULID) en `tasks_index`, nazca como casilla `- [ ]` en un bloque, desde texto seleccionado o como **Página** de **Tipo** `task`.
  - Cuando nace en un bloque, registra `origin_object_id` (la **Página** donde se escribió) y `origin_block_id` (el `blockId` del nodo Yjs, referenciable como `((blockId))`).
  - **Promoción y degradación (`task_promote_to_page` / `task_demote_to_block`):** promover una casilla crea o asocia una **Página** con **Tipo** `task` (`page_object_id`) manteniendo el mismo `task_id`, `origin_object_id` y `origin_block_id`. En la nota original, el bloque conserva exactamente su `blockId` y pasa a renderizar el vínculo sincronizado a la tarea promovida. Cualquier cambio de estado o fecha en la nota, en la **Página** de tarea o en una **Vista** actualiza la misma fila en `tasks_index`, el CRDT y la **Copia en Markdown** sin duplicar jamás la tarea.
- **Modelo de fechas y zona horaria (`r2-contract-tasks`):**
  - Distingue cuatro propiedades temporales: 1) **Fecha sin hora (`all_day_date`):** cadena `YYYY-MM-DD` flotante ligada al día civil (no se desplaza al cambiar de zona horaria), 2) **Fecha programada (`scheduled_at_ms`):** día o instante en que se planea realizar, 3) **Vencimiento (`due_at_ms`):** día o instante límite de entrega, y 4) **Aviso (`remind_at_ms`):** instante UTC exacto de notificación (en milisegundos UTC en SQLite e ISO-8601 en IPC).
  - Persiste `tz_iana` (p. ej. `America/Mexico_City`) y `is_all_day`. El motor en Rust calcula los cortes de **Sin fecha / Bandeja** (`TaskBucket::Unscheduled`), **Hoy**, **Próximo** y **Atrasado** evaluando `tz_iana` y las transiciones de horario de verano (DST).
  - **Relación con la Bandeja universal (`system_role = 'inbox'`, #94):** la **Bandeja universal** de R1 es la **Página** especial donde aterrizan las capturas rápidas (`Win+Shift+F`); el bucket `TaskBucket::Unscheduled` agrupa toda tarea activa sin `all_day_date`, `scheduled_at_ms` ni `due_at_ms` (tanto las capturadas dentro de la **Bandeja universal** como las creadas en cualquier otra **Página** sin fecha asignada) hasta que se programan en la revisión semanal.
- **Recurrencias sin duplicados (`r2-recurring`):**
  - `RecurrenceRule` soporta frecuencias diaria, semanal, mensual y anual/personalizada con dos modos de anclaje: `FromScheduled` (calendario fijo) o `FromCompletion` (relativo al instante en que se completó).
  - La generación de la siguiente ocurrencia usa la clave única `(series_id, occurrence_key)` dentro de la misma transacción SQLite: ni reiniciar la app, ni suspender el equipo ni cruzar un cambio de horario produce instancias duplicadas.
- **Notificaciones de Windows sin duplicados tras reinicio o suspensión (`r2-notifications`):**
  - Cola persistente `task_notification_queue` con clave de idempotencia única `dedupe_key = task_id || ':' || remind_at_ms` y estados `Pending`, `Dispatched`, `Snoozed`, `Completed`, `Failed`.
  - Al iniciar Fossil o recibir el evento de reanudación de suspensión de Windows, el planificador de `fossil-os` reconcilia avisos vencidos (`remind_at_ms <= now_ms` y `state = 'Pending'`), marca atómicamente `Dispatched` con `dispatched_at_ms` antes de invocar la notificación nativa de Windows 11, reintenta con backoff si el canal Toast falla temporalmente y ejecuta las acciones **Completar**, **Posponer (15 min / 1 h / mañana)** y **Abrir** de forma idempotente.

## Capa de vistas React (`@fossil/desktop` y `@fossil/editor`, sin lógica de almacenamiento)
- **Vistas de tareas (`r2-weekly`):** secciones **Sin fecha** (`TaskBucket::Unscheduled`, conectada con las capturas de la **Bandeja universal**), **Hoy**, **Próximo** y **Atrasado** con enlace directo a la **Página** y al bloque de origen (`((blockId))`), acciones rápidas por teclado y desde la **Paleta de comandos** (`Ctrl+K`).
- **Casillas y promoción en el editor (`r2-universal-tasks`):** bloque de tarea con selectores de fecha (`sin hora`, `programada`, `vencimiento`, `aviso`, `recurrencia` y zona horaria) y acción **Promover a página** in-situ sin alterar el `blockId` del documento Yjs.

## Criterios de aceptación, fuera de alcance y riesgos
- Crear una casilla en una nota de `Acme`, promoverla a **Página** y completarla en **Hoy** conserva el `origin_block_id`, muestra una única tarea en todas las **Vistas** y actualiza `- [x]` en la nota original y su **Copia en Markdown** en < 2 s.
- La consulta de **Sin fecha / Hoy / Próximo / Atrasado** responde en < 30 ms (p95) con 10 000 tareas y mantiene intacto el día de tareas `all_day_date` al cambiar el huso horario del sistema.
- Tras suspensión del equipo o cierre forzado durante la hora de varios avisos y tareas recurrentes, al reabrir el **Espacio** se entrega cada recordatorio pendiente una sola vez (0 duplicados) y existe exactamente una siguiente ocurrencia activa por serie.
- **Fuera de alcance:** rondas de **Aprobación** con recordatorios a clientes (R4), asignaciones multiusuario en vivo (R3) y tareas por voz (R7). **Riesgos:** desfase entre editor y `tasks_index` (mitigado indexando en la misma transacción SQLite del delta Yjs) y bloqueo de notificaciones en Windows (aviso discreto en UI conservando la cola).

## Contrato propuesto (SQLite en `crates/fossil-core` y `tauri-specta`)
> Marcas de tiempo en SQLite como `INTEGER` (ms UTC) e ISO-8601 en la frontera IPC (`docs/modules/storage.md`).
```sql
CREATE TABLE tasks_index (task_id TEXT PRIMARY KEY, page_object_id TEXT, origin_object_id TEXT NOT NULL, origin_block_id TEXT, series_id TEXT, occurrence_key TEXT, title TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'todo', priority INTEGER NOT NULL DEFAULT 0, all_day_date TEXT, scheduled_at_ms INTEGER, due_at_ms INTEGER, remind_at_ms INTEGER, tz_iana TEXT NOT NULL, recurrence_json TEXT, completed_at_ms INTEGER, updated_at_ms INTEGER NOT NULL, UNIQUE (series_id, occurrence_key));
CREATE INDEX idx_tasks_bucket ON tasks_index (status, all_day_date, due_at_ms, scheduled_at_ms);
CREATE TABLE task_notification_queue (dedupe_key TEXT PRIMARY KEY, task_id TEXT NOT NULL, remind_at_ms INTEGER NOT NULL, state TEXT NOT NULL DEFAULT 'Pending', retry_count INTEGER NOT NULL DEFAULT 0, dispatched_at_ms INTEGER, snoozed_until_ms INTEGER, updated_at_ms INTEGER NOT NULL);
```
```rust
pub enum TaskBucket { Unscheduled, Today, Upcoming, Overdue }
pub enum TaskStatus { Todo, InProgress, Done, Canceled }
pub enum RecurrenceAnchor { FromScheduled, FromCompletion }
pub struct TaskDateSpec { pub all_day_date: Option<String>, pub scheduled_at_utc: Option<String>, pub due_at_utc: Option<String>, pub remind_at_utc: Option<String>, pub tz_iana: String }
pub struct RecurrenceRule { pub freq: String, pub interval: u32, pub by_weekday: Vec<u8>, pub anchor: RecurrenceAnchor }
pub struct TaskItem { pub task_id: String, pub page_object_id: Option<ObjectId>, pub origin_object_id: ObjectId, pub origin_block_id: Option<String>, pub title: String, pub status: TaskStatus, pub dates: TaskDateSpec, pub recurrence: Option<RecurrenceRule> }
// Comandos IPC (apps/desktop/src/bindings.ts):
// tasks_list_bucket(bucket: TaskBucket, now_utc: String, viewer_tz: String, limit: u32) -> Result<Vec<TaskItem>, CoreError>
// task_promote_to_page(task_id: String) -> Result<TaskItem, CoreError>
// task_demote_to_block(task_id: String) -> Result<TaskItem, CoreError>
// task_update_dates(task_id: String, dates: TaskDateSpec, recurrence: Option<RecurrenceRule>) -> Result<TaskItem, CoreError>
// task_complete(task_id: String, completed_at_utc: String) -> Result<TaskCompletionResult, CoreError>
// task_notification_ack(dedupe_key: String, action: NotificationAction) -> Result<TaskItem, CoreError>
```

## Términos propuestos para `docs/GLOSSARY.md` (ADR-0017)
- **Bandeja universal (`Inbox`):** **Página** del sistema (`system_role = 'inbox'`, #94) donde aterrizan las capturas rápidas; en la vista de tareas, la sección **Sin fecha** (`TaskBucket::Unscheduled`) reúne las tareas pendientes aún no programadas (incluidas las creadas en la **Bandeja universal**).
- **Proyecto (`Project`):** **Página** de **Tipo** `project` que agrupa hitos, tareas, decisiones, reuniones y entregables con progreso calculado.
- **Rastro (`Trail`):** Cadena trazable `Idea → Decisión → Tarea → Entregable` con eslabones confirmados o inferidos.
- **Enfoque (`Focus`):** Vista limpia de ejecución centrada en una sola tarea o proyecto activo.
- **Plantillas de Espacio (`Workspace templates`):** Paquetes iniciales (`software`, `estudio`, `agencia`, `personal`) con datos de ejemplo borrables mediante `workspace_clear_sample`.
