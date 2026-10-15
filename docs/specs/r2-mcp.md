# Spec R2: Servidor y cliente MCP sobre el registro único

> **Estado:** Borrador — requiere aprobación del PO. · **Área:** `area:mcp`, `area:ai`, `area:storage`, `area:ui`
> **Orden de ejecución:** `contrato de datos` (`r2-contract-tools`) → `trabajo` (herramientas del **Espacio** en `r2-views-core`, `r2-universal-tasks`, `r2-projects`) → `agente` (`r2-mcp-secure`, `r2-ai-review`, `r2-agent-log`, `r2-ai-cost`). Ningún conector ni vista MCP se construye antes de mergear `r2-contract-tools`.

## Qué y Por qué
- **Qué:** Servidor MCP local (`127.0.0.1` y `stdio`) y cliente MCP en `crates/fossil-mcp` construidos sobre el registro único de herramientas (`ActionRegistry`), con permisos y límites de entrada validados en Rust, aislamiento de cargas externas como contenido no confiable, escritura mediada por **Plan de cambios**, aviso de envío externo y bitácora sin secretos.
- **Por qué:** Para integrar el **Espacio** de `Mi equipo` en `Acme` con clientes MCP locales y servidores externos (Shopify, GA4, Google Drive, Canva, GitHub y sistema de archivos) manteniendo privacidad local-first: nada escucha fuera de `127.0.0.1`, toda credencial vive en Windows Credential Manager y ningún payload externo autoriza escrituras por sí mismo.

## Capa de datos, transporte y seguridad (Rust / SQLite en `crates/fossil-mcp` y `crates/fossil-core`, sin UI)
- **Un solo registro de herramientas y permisos en Rust (`r2-contract-tools`, `r2-mcp-secure`):**
  - El servidor MCP local no duplica lógica de negocio: publica las herramientas del `ActionRegistry` (`space.search`, `page.get`, `type.list`, `tasks.list`, `page.upsert`, `object.set_field`) filtradas por la política activa en Rust.
  - Las herramientas descubiertas desde servidores MCP externos se montan en el mismo `ActionRegistry` con prefijo `mcp.<server_id>.<tool_name>` y nivel de riesgo `ToolRiskLevel::External`.
  - Toda invocación entrante (`InvocationOrigin::McpInbound`) o saliente (`InvocationOrigin::McpOutbound`) valida permisos en Rust antes de ejecutarse: el servidor local arranca apagado y en modo `ReadOnly` por defecto, exige token Bearer en `127.0.0.1` (comparación en tiempo constante) y falla al iniciar si se configura una IP distinta de loopback.
- **Límites de entrada hostil y aislamiento de contenido no confiable (`r2-mcp-secure`):**
  - Rust valida toda solicitud y respuesta MCP como entrada hostil: límite de 1 MB por mensaje JSON-RPC, profundidad máxima de 16 niveles en JSON, esquema estricto, timeout de 15 s por llamada y normalización canónica de rutas que bloquea cualquier acceso fuera del directorio del **Espacio** (`..`, rutas absolutas externas o enlaces simbólicos que escapen).
  - Todo dato recibido de un servidor MCP externo o enviado por un cliente MCP entrante se marca con `TrustLevel::UntrustedData`. El contenido no confiable jamás puede elevar permisos, encadenar herramientas `Destructive`/`External` ni aprobar un plan: toda mutación entrante por MCP genera un `AgentChangePlan` que requiere confirmación de la persona usuaria en la UI nativa de Fossil.
- **Credenciales, aviso de envío externo e historial sin secretos (`r2-agent-log`, `r2-ai-cost`):**
  - Los secretos de conectores y el token del servidor local se almacenan exclusivamente en el almacén de credenciales de Windows (`Credential Manager` bajo `fossil/mcp/<server_id>`), nunca en SQLite, `.fossil/` ni logs.
  - Antes de que una llamada `McpOutbound` transmita contenido del **Espacio** a un servidor MCP externo, Rust genera el `OutboundContextPreview` (destino, herramienta, **Páginas** involucradas y tamaño) y exige confirmación de envío externo según la política del **Espacio**.
  - Cada llamada entrante o saliente se registra en `agent_operation_log` pasando primero por `SecretScrubber` en Rust para eliminar tokens, claves y rutas sensibles.

## Capa de vistas React (`@fossil/desktop`, sin manejo de secretos ni validación de permisos)
- **Panel de servidor local y catálogo de conectores MCP:** controles en Ajustes para habilitar el servidor en `127.0.0.1`, rotar token Bearer, elegir modo (`Solo lectura` vs. `Escritura con Plan de cambios`) y configurar presets de un clic (Shopify, GA4, Google Drive, Canva, GitHub y sistema de archivos) sin exponer secretos tras guardarlos.
- **Confirmación de envío externo y bitácora:** diálogo que muestra qué datos se enviarán al conector MCP externo antes de autorizar la llamada y vista filtrable del **Historial de operaciones** MCP.

## Criterios de aceptación, fuera de alcance y riesgos
- El servidor MCP rechaza conexiones sin token válido (HTTP 401), aborta el arranque fuera de `127.0.0.1` y rechaza en < 5 ms payloads > 1 MB, JSON con > 16 niveles o rutas que escapen del **Espacio**.
- Una llamada `McpInbound` de escritura o una respuesta maliciosa de un servidor MCP externo nunca muta SQLite ni el CRDT directamente: queda retenida como `AgentChangePlan` hasta que la persona usuaria la apruebe en Fossil.
- Revocar un conector o rotar el token corta las sesiones activas de inmediato, limpia la entrada en Windows Credential Manager y deja 0 secretos en `mcp_servers` y `agent_operation_log`.
- **Fuera de alcance:** servidor MCP remoto en la nube o webhooks (R5), automatizaciones por cron/evento (R5) y plugins en iframe/Wasm (R7). **Riesgos:** procesos hijo MCP colgados (mitigado con timeout de 15 s y terminación del árbol de procesos al cerrar el **Espacio**).

## Contrato propuesto (SQLite en `crates/fossil-core` y `tauri-specta`)
```sql
CREATE TABLE mcp_servers (server_id TEXT PRIMARY KEY, preset_key TEXT, name TEXT NOT NULL, transport_kind TEXT NOT NULL, endpoint_or_cmd TEXT NOT NULL, args_json TEXT NOT NULL DEFAULT '[]', enabled INTEGER NOT NULL DEFAULT 0, trust_policy TEXT NOT NULL DEFAULT 'confirm_every_call', updated_at_utc TEXT NOT NULL);
CREATE TABLE mcp_local_server_config (singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1), enabled INTEGER NOT NULL DEFAULT 0, bind_port INTEGER NOT NULL DEFAULT 39421, write_mode TEXT NOT NULL DEFAULT 'read_only', max_payload_bytes INTEGER NOT NULL DEFAULT 1048576, call_timeout_ms INTEGER NOT NULL DEFAULT 15000, updated_at_utc TEXT NOT NULL);
```
```rust
pub enum McpWriteMode { ReadOnly, PlanRequired }
pub enum McpTransportKind { Stdio, LoopbackHttp }
pub struct LocalMcpServerStatus { pub running: bool, pub bind_addr: String, pub write_mode: McpWriteMode, pub max_payload_bytes: u32 }
pub struct McpServerConfig { pub server_id: String, pub preset_key: Option<String>, pub name: String, pub transport_kind: McpTransportKind, pub enabled: bool }
pub struct McpToolDescriptor { pub tool_id: String, pub server_id: String, pub name: String, pub description: String, pub risk: ToolRiskLevel }
// Comandos IPC (apps/desktop/src/bindings.ts):
// mcp_local_server_configure(enabled: bool, write_mode: McpWriteMode) -> Result<LocalMcpServerStatus, CoreError>
// mcp_local_server_rotate_token() -> Result<String, CoreError>
// mcp_client_upsert_server(config: McpServerConfig, secret: Option<String>) -> Result<McpServerConfig, CoreError>
// mcp_client_remove_server(server_id: String, purge_credential: bool) -> Result<(), CoreError>
// mcp_client_list_tools(server_id: String) -> Result<Vec<McpToolDescriptor>, CoreError>
```
