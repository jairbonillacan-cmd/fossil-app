# ai

**Propósito:** router de modelos de IA y puente que ejecuta los CLIs oficiales (`agy`, `claude`, `codex`) como procesos hijos, sin tocar credenciales (ADR-0011).

**Rutas:** `crates/fossil-ai` (router), `crates/fossil-bridge` (puente), `apps/desktop/src/ai-panel.tsx` (panel de chat con contexto, vista previa y acciones sobre selección, #14).

**Contratos públicos:** trait `Provider` + eventos IPC `ai:event` (spec `docs/specs/r1-ai-router-bridge.md`; contrato en #16).

**Cómo probar:** los fixtures del spike #14 están en `crates/fossil-bridge/tests/fixtures/` (rama `spike/14-ai-bridge`); el parser de streaming se testa contra ellos.

## Contrato (#16)

Tipos wire en `crates/fossil-ai/src/contract.rs` (`specta::Type`; sin `i64/u64`: tokens `u32`, costos `f64`, duraciones `u32` ms, ids Ulid string), trait `Provider`/`ProviderError` en `src/provider.rs` y comandos en `apps/desktop/src-tauri/src/commands/ai.rs` (stubs `NotImplemented` hasta #32/#33; `ai_routes_get` devuelve los defaults de §Router).

| Superficie | Forma |
|---|---|
| `ai_providers() -> ProviderInfo[]` | `ProviderId` + `Caps` + `Health` (probe perezoso; nunca al arrancar) |
| `ai_chat(req: ChatRequest) -> RequestId` | la respuesta llega en streaming por `ai:event { request_id, event: ChatEvent }` |
| `ai_cancel(request_id) -> ()` | debe responder en < 500 ms (mata el árbol de procesos) |
| `ai_routes_get/set(rules: RouteRule[])` | `RouteRule { task: TaskKind, prefer: ProviderId[] }` (cadena de respaldo) |

`ChatEvent = Started{provider,model} | Delta{text} | ToolCall{name,arguments} | Usage | Done{summary} | Error{message}`; `ProviderError` (trait, Rust) ≠ `AiError` (IPC).

## Proveedores por API y keyring (#32, #55)
Claves en el Administrador de credenciales de Windows (`com.fossil.ai`, `keyring.rs`, rechazando proveedores sin clave API), streaming SSE/NDJSON (`http.rs`, acumulando `Vec<u8>` hasta `\n` antes de decodificar UTF-8 con cota de 1 MiB por línea y abortando con `tokio::select!` en `tx.closed()`) y proveedores con `health()` perezoso: Anthropic (`anthropic.rs`), OpenAI (`openai.rs`), Gemini API (`gemini.rs`, header `x-goog-api-key`) y Ollama local (`ollama.rs`, `127.0.0.1:11434`, `GET /api/version` y `POST /api/chat`).

## Router, registro de uso y confirmación en UI (#34, #55, #80)
`AiRouter` (`router.rs`) recorre la cadena `RouteRule` (`default_routes()`), salta proveedores no listos (`HealthStatus != Ready` o `ProviderError::Unavailable`), valida capacidades y deduplica `prefer` al editar rutas (`ai_routes_get`/`ai_routes_set`), expone `ai_providers` con probe perezoso, estima consumo (`estimate_usage`, `default_model`), cancela solicitudes en vuelo (`chat_with_id`/`cancel`), redacta claves en salud y errores, y persiste rutas (en transacción SQLite) y uso de tokens/costo en una conexión SQLite propia de `fossil-ai` (`ai_routes`, `ai_usage`, sin modificar las migraciones ni el esquema de `fossil-core` y sin guardar prompts). En `ai-panel.tsx`, antes de enviar se muestran proveedor, modelo, contexto y tokens estimados; las respuestas se presentan como propuestas con el consumo real y solo se insertan al confirmar.

## Tabla de CLIs (spike #14)

| | `claude` (Claude Code 2.1.299) | `codex` (0.162.1) | `agy` (Antigravity CLI) |
|---|---|---|---|
| **Headless** | `claude -p` (prompt: arg o stdin) | `codex exec [PROMPT]` (arg, `-` fuerza stdin) | `agy -p` / `--print` / `--prompt` |
| **Salida** | `--output-format text\|json\|stream-json` (solo con `-p`) | `--json` (JSONL); `-o <file>` escribe el último mensaje | `--output-format text\|json\|stream-json` |
| **Streaming** | NDJSON: `system/init` → `assistant` → `result` (con `usage`, `total_cost_usd`, `is_error`); `--include-partial-messages` para deltas | NDJSON: `thread.started` → `turn.started` → `item.completed` → `turn.completed` (usage) | NDJSON: `init` → `step_update` (con `text_delta`) → `result` |
| **Entrada** | `--input-format stream-json` (bidireccional) | stdin (cerrar stdin al final; con prompt en arg lo concatena como `<stdin>`) | `--input-format stream-json` (requiere `--output-format stream-json`) |
| **Modelo** | `--model <alias|nombre>`; `--effort low..max`; `--fallback-model a,b` | `-m, --model`; inválido → evento `type:"error"` + exit 1 | `--model <slug>` (`agy models`); `--effort low\|medium\|high` |
| **MCP propio** | `claude mcp add[-json] <n> ...`; o `--mcp-config <file>` + `--strict-mcp-config` por invocación | `codex mcp add <n> -- <cmd>` / `--url`; o `-c mcp_servers...` | sin `mcp add`: editar `~/.gemini/config/mcp_config.json` (o `.agents/mcp_config.json`), clave `mcpServers` |
| **Sesión/health** | sin sesión: exit 1 con `result:"Not logged in…"`; init trae `apiKeySource` | usa la sesión activa del propio CLI | usa credenciales cacheadas; sin auth falla rápido, no se cuelga |
| **Timeout** | nuestro (tokio) | nuestro; `--ephemeral` para no persistir sesión | `--print-timeout` (default **5 min**) |
| **ACP** | **No** nativo (adaptador externo `claude-code-acp`) | **No** nativo (adaptador externo `codex-acp` sobre `app-server` experimental) | **No** (issue abierta google-antigravity/antigravity-cli#31) |

## Latencias de referencia (prompt trivial)

| Operación | Latencia |
|---|---|
| `codex --version` (arranque, binario Rust) | ~0.29 s |
| `claude --version` (shim npm→JS) / `claude.exe` nativo | ~1.1 s / ~2.5 s |
| `codex exec --json` E2E frío / caliente | 9.7 s / 5.9 s |
| `claude -p` sin sesión (frío / caliente) | 9.4 s / 4.9 s |
| `codex exec` modelo inválido (fallo) | 2.7 s |
| `taskkill /F /T` del árbol completo | **142 ms** (presupuesto < 500 ms ✓) |

**Gotchas:**
- `codex exec` con prompt en arg y stdin abierto espera stdin: **cerrar stdin** tras escribir (o pasar prompt solo por stdin con `-`).
- `codex exec` envía ~16 k tokens de sistema por llamada (~13 k cacheados): presupuesto de cuota.
- El PID de MSYS/Git-Bash ≠ PID de Windows: para matar el árbol usar Job Objects o el winpid.
- `codex` fuera de un repo git exige `--skip-git-repo-check`.
- Detección: `%SystemRoot%\System32\where.exe` filtrando extensiones ejecutables (`.exe`, `.cmd`, `.bat`, `.com`) en Windows para descartar shims POSIX de npm; `agy` se instala en `%LOCALAPPDATA%\agy\bin` (agregar a PATH de detección).

**Implementación puente (#33, #55):** `crates/fossil-bridge/src/lib.rs` detecta `agy` (`%LOCALAPPDATA%\agy\bin`), `claude` y `codex` con `where.exe` (descartando candidatos sin extensión ejecutable en Windows), parsea NDJSON a `ChatEvent` (validado contra `crates/fossil-bridge/tests/fixtures/*.jsonl`) y cancela el árbol de procesos con `taskkill /F /T` en < 500 ms; `BridgeProvider` (`crates/fossil-bridge/src/runner.rs`) implementa `Provider` (`health()` perezoso con `--version` y `chat()` ejecutando subprocesos headless sin variables de entorno de claves de terceros, abortando con `tx.closed()` y propagando códigos de salida != 0 para fallback).

**ADRs relacionados:** [0011](../adr/0011-ai-router-bridge.md), [0013](../adr/0013-bridge-headless-jsonl.md)
