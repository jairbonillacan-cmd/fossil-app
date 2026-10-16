# Spec R2: Agente con herramientas, plan de cambios y control de costos

> **Estado:** Borrador — requiere aprobación del PO. · **Área:** `area:ai`, `area:mcp`, `area:storage`, `area:ui`
> **Orden de ejecución:** `contrato de datos` (`r2-contract-tools`) → `trabajo` (acciones de dominio registradas desde `r2-views-core`, `r2-universal-tasks`, `r2-projects`) → `agente` (`r2-mcp-secure`, `r2-ai-review`, `r2-agent-log`, `r2-ai-cost`). Ninguna vista ni flujo del agente se construye antes de mergear `r2-contract-tools`.

## Qué y Por qué
- **Qué:** Registro único de herramientas (`ActionRegistry`) compartido por la interfaz, la **Paleta de comandos**, el agente de IA y MCP con validación de permisos en Rust, aislamiento estricto de contenido no confiable, **Plan de cambios** revisable y reversible antes de escribir, historial de operaciones sanitizado sin secretos, control de costos/tokens y aviso explícito de envío externo.
- **Por qué:** Cumple el principio "toda acción es una herramienta" (ADR-0005) para `Mi equipo` en `Acme` asegurando en Rust que ningún texto leído de una **Página** o de un servidor externo pueda autorizar una escritura ni exfiltrar credenciales o datos sin consentimiento.

## Capa de datos, permisos y ejecución (Rust / SQLite en `crates/fossil-core` y `crates/fossil-ai`, sin UI)
- **Registro único y permisos validados en Rust (`r2-contract-tools`):**
  - `ActionRegistry` declara cada acción una sola vez (`tool_id`, esquema JSON de entrada/salida, `ToolRiskLevel`: `ReadOnly`, `WorkspaceWrite`, `Destructive`, `External` y capacidades requeridas). La UI, la **Paleta de comandos** (`Ctrl+K`), el agente y `fossil-mcp` invocan el mismo `ActionDispatcher` en Rust.
  - La validación de permisos ocurre siempre en Rust según el origen (`InvocationOrigin`: `UiDirect`, `CommandPalette`, `AgentTurn`, `McpInbound`, `McpOutbound`) y la política activa del **Espacio**; el frontend React jamás autoriza llamadas por su cuenta.
- **El contenido no confiable nunca autoriza una escritura (`r2-contract-tools`, `r2-mcp-secure`):**
  - Todo texto leído de **Páginas**, bloques, archivos importados o respuestas de servidores MCP entra al contexto etiquetado con `TrustLevel::UntrustedData` dentro de delimitadores estructurales de datos.
  - Cuando el origen es `AgentTurn` o `McpInbound`, ninguna herramienta `WorkspaceWrite`, `Destructive` o `External` puede ejecutarse ni auto-aprobarse desde la salida del modelo: Rust exige un `UserApprovalToken` de un solo uso emitido exclusivamente por un comando IPC de confirmación humana (`ai_plan_approve` o `ai_confirm_external_send`) vinculado al hash SHA-256 exacto (`plan_hash`) de las operaciones propuestas.
- **Plan de cambios revisable y reversible (`r2-ai-review`):**
  - Las mutaciones propuestas por el agente se acumulan en seco (`dry-run` / staging) dentro de un `AgentChangePlan` en SQLite con: lista de **Objetos**/**Páginas** afectados, diferencias antes/después (`diff` de bloques CRDT, **Campos** y relaciones), proveedor y modelo que generó el plan.
  - Al aprobar el usuario (`ai_plan_approve`), Rust aplica las mutaciones en una transacción atómica y guarda las instantáneas previas asociadas a `revert_batch_id`. Cancelar (`ai_plan_cancel`) descarta el plan sin modificar el **Espacio**; deshacer (`ai_plan_revert`) restaura el estado previo completo.
- **Historial de operaciones sin secretos (`r2-agent-log`):**
  - Tabla `agent_operation_log` en SQLite que registra toda herramienta ejecutada o rechazada (`origin`, `tool_id`, `risk`, `affected_ids_json`, `sanitized_args_json`, `status`, `revert_batch_id`, `created_at_ms`).
  - Un sanitizador en Rust (`SecretScrubber`) redacta antes de persistir o mostrar en pantalla cualquier clave de API (`sk-*`, tokens Bearer), cabeceras de autorización, valores del almacén de credenciales de Windows y rutas del sistema fuera del **Espacio**.
- **Costo, presupuesto de tokens y aviso de envío externo (`r2-ai-cost`):**
  - Antes de despachar una solicitud a un proveedor de IA en la nube o a un conector MCP externo, Rust construye `OutboundContextPreview` detallando las **Páginas**/bloques incluidos, el proveedor y modelo, el conteo de tokens de entrada, el costo estimado y si el destino sale de `127.0.0.1`.
  - `ai_budget_policy` aplica en Rust topes de tokens por turno (`max_turn_tokens`) y de gasto mensual (`monthly_cap_micros`), alertando al 80 % y bloqueando cualquier llamada de pago al 100 % antes de abrir la red (con opción de caer a modelos locales o suscripción).

## Capa de vistas React (`@fossil/desktop`, sin validación de permisos en cliente)
- **Revisor de Plan de cambios (`r2-ai-review`):** panel de revisión con lista de objetos afectados, visor de diferencias (`diff`) por **Página** y **Campo**, insignia del modelo utilizado y botones **Aplicar cambios**, **Cancelar** y **Deshacer plan**.
- **Aviso de envío externo, costos e historial (`r2-ai-cost`, `r2-agent-log`):** resumen de contexto enviado, diálogo de confirmación antes de enviar datos fuera del equipo, medidor de consumo mensual/por turno en **Modelos de IA** y visor auditable del **Historial de operaciones**.

## Criterios de aceptación, fuera de alcance y riesgos
- Un prompt malicioso inyectado dentro de una **Página** o respuesta MCP es incapaz de ejecutar o auto-aprobar escrituras: Rust rechaza toda mutación sin `UserApprovalToken` válido para el `plan_hash`.
- Cancelar un `AgentChangePlan` deja 0 cambios en SQLite/CRDT; aplicar y revertir un plan sobre 10 **Páginas** restaura exactamente sus bloques, **Campos** y **Copia en Markdown** en < 2 s.
- `agent_operation_log` audita el 100 % de las operaciones con 0 secretos o tokens filtrados; al llegar al 100 % del presupuesto mensual o al tope de tokens por turno, Rust bloquea el envío externo antes de tocar la red.
- **Fuera de alcance:** agente analista SQL sobre datos comerciales (R5), voz de marca en publicaciones (R4) y minutas por voz (R7). **Riesgos:** tarifas desactualizadas (mitigado con tabla local editable y topes en tokens además de USD).

## Contrato propuesto (SQLite en `crates/fossil-core` y `tauri-specta`)
> Marcas de tiempo en SQLite como `INTEGER` (ms UTC) e ISO-8601 en la frontera IPC (`docs/modules/storage.md`).
```sql
CREATE TABLE agent_change_plans (plan_id TEXT PRIMARY KEY, plan_hash TEXT NOT NULL, origin TEXT NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL, status TEXT NOT NULL, items_diff_json TEXT NOT NULL, revert_batch_id TEXT, created_at_ms INTEGER NOT NULL);
CREATE TABLE agent_operation_log (log_id TEXT PRIMARY KEY, origin TEXT NOT NULL, tool_id TEXT NOT NULL, risk_level TEXT NOT NULL, target_ids_json TEXT NOT NULL, sanitized_args_json TEXT NOT NULL, status TEXT NOT NULL, revert_batch_id TEXT, created_at_ms INTEGER NOT NULL);
CREATE TABLE ai_usage_ledger (entry_id TEXT PRIMARY KEY, provider TEXT NOT NULL, model TEXT NOT NULL, task_kind TEXT NOT NULL, input_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL, cost_micros_usd INTEGER NOT NULL, is_external INTEGER NOT NULL, created_at_ms INTEGER NOT NULL);
CREATE TABLE ai_budget_policy (scope TEXT PRIMARY KEY, max_turn_tokens INTEGER NOT NULL DEFAULT 32000, monthly_cap_micros_usd INTEGER, warn_percent INTEGER NOT NULL DEFAULT 80, require_external_confirm INTEGER NOT NULL DEFAULT 1, updated_at_ms INTEGER NOT NULL);
```
```rust
pub enum ToolRiskLevel { ReadOnly, WorkspaceWrite, Destructive, External }
pub enum InvocationOrigin { UiDirect, CommandPalette, AgentTurn, McpInbound, McpOutbound }
pub enum TrustLevel { TrustedSystem, UntrustedData }
pub struct AgentChangePlan { pub plan_id: String, pub plan_hash: String, pub provider: String, pub model: String, pub status: String, pub diffs: Vec<ObjectChangeDiff>, pub revert_batch_id: Option<String> }
pub struct OutboundContextPreview { pub destination: String, pub is_external: bool, pub provider: String, pub model: String, pub source_object_ids: Vec<ObjectId>, pub estimated_tokens: u32, pub estimated_cost_micros_usd: u32 }
// Comandos IPC (apps/desktop/src/bindings.ts):
// action_registry_list() -> Result<Vec<ActionDescriptor>, CoreError>
// ai_plan_preview(plan_id: String) -> Result<AgentChangePlan, CoreError>
// ai_plan_approve(plan_id: String, plan_hash: String) -> Result<AgentPlanExecutionResult, CoreError>
// ai_plan_cancel(plan_id: String) -> Result<(), CoreError>
// ai_plan_revert(plan_id: String) -> Result<u32, CoreError>
// ai_agent_log_list(limit: u32, cursor: Option<String>) -> Result<Vec<AgentOperationLogEntry>, CoreError>
// ai_usage_get_summary(month_yyyy_mm: String) -> Result<MonthlyUsageSummary, CoreError>
```
