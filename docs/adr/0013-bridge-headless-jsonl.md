# ADR-0013: El puente de R1 usa headless JSONL (proceso por petición), sin ACP ni daemon

- **Estado:** aceptado (validado por el spike #14) · **Fecha:** 2026-10-13 · **Área:** `area:ai`

## Contexto
El spike #14 verificó en la máquina del PO (y en docs oficiales de `agy`) los tres
mecanismos candidatos para hablar con los CLIs oficiales: modo headless con salida
JSONL, ACP y los daemons experimentales (`codex app-server`/`exec-server`). Resultados:
- `claude -p --output-format stream-json` (2.1.299), `codex exec --json` (0.162.1) y
  `agy -p --output-format stream-json` existen, hacen streaming NDJSON y funcionan sin
  TTY; `codex exec` respondió E2E usando la sesión ChatGPT ya iniciada (el CLI lee sus
  propias credenciales; Fossil nunca las toca, ADR-0011).
- **Ninguno soporta ACP de forma nativa**: claude y codex requieren adaptadores externos
  (`claude-code-acp`, `codex-acp`); `agy` tiene la issue abierta
  google-antigravity/antigravity-cli#31.
- `codex app-server`/`exec-server` están marcados `[experimental]` (la interfaz puede cambiar).

## Decisión
En R1, `fossil-bridge` lanza **un proceso hijo por petición** en modo headless con
salida JSONL (parseada en streaming), stdin como canal del prompt, y sin ACP ni
daemons. La cancelación mata el árbol de procesos del hijo (Job Object de Windows o
`taskkill /F /T`; medido: 142 ms). El registro del servidor MCP de Fossil se hace con
los mecanismos nativos de cada CLI (`claude mcp add-json`, `codex mcp add`, y edición
de `~/.gemini/config/mcp_config.json` para `agy`).

## Consecuencias
- **Latencia:** arranque medido 0.3–2.5 s + llamada; E2E trivial 5.9–9.7 s. Aceptable
  para chat; la IA inline va por API/Ollama (reglas del router en ADR-0011).
- **Cuota:** `codex exec` consume ~16 k tokens de sistema por llamada (~13 k cacheados).
- **Simplicidad:** sin dependencia de protocolos experimentales; si ACP llega a ser
  nativo (issue de `agy`), se aísla en el adaptador de ese CLI.
- **Health check bajo demanda:** una invocación mínima headless basta para detectar
  "sin sesión" (claude emite `apiKeySource:"none"` / `result:"Not logged in…"`;
  `agy` falla rápido si no hay credenciales cacheadas). Nunca al arrancar Fossil.

## Alternativas consideradas
- **ACP nativo:** no existe hoy en ninguno de los tres CLIs.
- **Adaptadores ACP externos:** añaden procesos de terceros entre Fossil y el CLI, más
  superficie de instalación y falla; sin beneficio sobre JSONL para chat streaming.
- **`codex app-server` (daemon persiste sesión):** experimental y solo cubre codex;
  reevaluar cuando pierda la etiqueta.
- **`claude --bg` (sesión en background):** diseñado para uso humano con `attach`;
  acopla el ciclo de vida de Fossil a sesiones guardadas del CLI.
