# Spec R1: IA (router de modelos + puente de suscripciones)

**Área:** `area:ai` · **ADR:** 0011 · **Crates:** `fossil-ai`, `fossil-bridge`

## Qué y por qué
Usar IA dentro de Fossil desde el día uno con las suscripciones que la persona usuaria ya paga (Google vía `agy`, Anthropic vía Claude Code, OpenAI vía Codex), además de claves de API y Ollama local.

## Contrato (`type:contract`)
```rust
#[async_trait]
pub trait Provider {
  fn id(&self) -> ProviderId;
  fn capabilities(&self) -> Caps;          // chat, tools, embeddings, streaming, local
  async fn health(&self) -> Health;        // instalado / sesión / cuota si se conoce
  async fn chat(&self, req: ChatRequest, tx: Sender<ChatEvent>) -> Result<ChatSummary>;
}
pub enum ChatEvent { Delta(String), ToolCall{..}, Usage{input, output, cost_usd: Option<f64>}, Done, Error(String) }
pub struct RouteRule { task: TaskKind, prefer: Vec<ProviderId> }  // cadena de respaldo
```
- **Eventos IPC:** `ai:event { request_id, event }`.
- **Comandos:** `ai_providers()`, `ai_chat(req) -> request_id`, `ai_cancel(request_id)`, `ai_routes_get/set`.

## Proveedores en R1
1. **Puente (`fossil-bridge`):**
   - **Detección** en el PATH de `agy`, `claude` y `codex`, con su versión. La sesión se verifica con una llamada mínima *bajo demanda*, nunca automáticamente al arrancar.
   - **Ejecución:** `tokio::process`, con el prompt por stdin, un directorio temporal como cwd, timeout configurable, cancelación (kill del árbol de procesos) y streaming parseado (JSON por líneas si existe, texto si no).
   - **Prohibido** leer archivos de credenciales de esos CLIs.
2. **API:** Anthropic, OpenAI y Gemini API, con claves guardadas en el Administrador de credenciales de Windows (crate `keyring`). Nunca en archivos ni en logs.
3. **Local:** Ollama (`http://127.0.0.1:11434`).

## Router
**Reglas por defecto:**

| Tarea | Orden de proveedores |
|---|---|
| `chat` | puente (agy → claude → codex) → API → Ollama |
| `inline` | API rápida → Ollama → puente |

- Se pueden editar en Ajustes → IA.
- Si un proveedor falla (no instalado, sin sesión, cuota agotada), se pasa al siguiente y la UI lo indica.

## UI
- **Panel IA** (barra lateral derecha):
  - chat con streaming;
  - selector de modelo/ruta;
  - contexto adjunto: página actual, selección y `@objeto` (chips visibles y removibles);
  - **vista previa del contexto** que se enviará.
- **Acciones:** insertar la respuesta en la página, reemplazar la selección o crear una página nueva.
- **IA inline** (selección → menú): reescribir, resumir, traducir, cambiar tono y continuar.
- **Ajustes → IA:**
  - estado de cada proveedor (instalado, sesión, versión) y botón "Probar";
  - claves de API;
  - reglas del router;
  - registro de uso (tokens y costo estimado).

## Spike previo (obligatorio, 1–2 días)
1. Confirmar los flags reales:
   - `agy -p` (¿tiene salida JSON o streaming? ¿cómo se elige modelo? ¿cómo se le pasa una config de MCP?);
   - `claude -p --output-format stream-json`;
   - `codex exec --json`.
2. Verificar si alguno soporta **ACP**.
3. **Entregable:** una tabla en `docs/modules/ai.md` con los comandos exactos, el formato de salida y las limitaciones. El ADR-0011 se actualiza si algo cambia.

## Criterios de aceptación
- Con `agy` logueado, el chat de Fossil responde con la suscripción de Google **sin que Fossil toque credenciales**. Se verifica revisando que el código no lee rutas de credenciales.
- Al cancelar se mata el proceso en < 500 ms.
- Si se quita `agy` del PATH, el router cae a la siguiente ruta con un aviso claro.
- Hay tests del parser de streaming con fixtures grabados de cada CLI.

## Fuera de alcance
Agente con herramientas y MCP (R2), RAG (R5), automatizaciones (R5).
