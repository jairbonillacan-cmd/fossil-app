# ADR-0011: Router de IA + puente de CLIs oficiales (sin reutilizar tokens)

- **Estado:** aceptado (validado por el spike #14, 2026-10-13: los tres comandos headless existen; **ningún CLI soporta ACP nativo** — detalle y mecanismo de ejecución en ADR-0013) · **Fecha:** 2026-10-13 · **Área:** `area:ai`

## Contexto
Muchas personas ya pagan una suscripción de IA (Google, Anthropic u OpenAI) y quieren usarla dentro de Fossil sin pagar además una clave de API. Hay tres limitaciones:
- Google no ofrece una vía oficial para que apps de terceros usen la suscripción.
- Extraer o proxear el token OAuth de Gemini CLI o de Antigravity viola su política (desde el 25-mar-2026) y ha provocado baneos.
- Desde el 18-jun-2026, Pro y Ultra se usan con el **Antigravity CLI (`agy`)**.

## Decisión
1. **`fossil-bridge`** ejecuta como proceso hijo, en modo headless, el **CLI oficial en el que el usuario ya inició sesión**:

   | Plan | Comando |
   |---|---|
   | Google (planes Pro y Ultra) | `agy -p` |
   | Anthropic (Claude) | `claude -p --output-format stream-json` |
   | OpenAI (ChatGPT) | `codex exec --json` |

   - Si el CLI soporta **ACP**, se usa ACP en lugar del modo headless.
   - Fossil registra su servidor MCP en el CLI, para que el agente pueda actuar sobre Fossil.
2. **Fossil nunca lee, copia ni proxea credenciales de otros CLIs.** Queda prohibido, por ejemplo, leer `~/.gemini/*` o los tokens de agy.
3. **`fossil-ai`** es un router con reglas editables:

   | Uso | Ruta |
   |---|---|
   | Chat y agente | Suscripción vía el puente |
   | IA inline rápida y embeddings | Clave de API u Ollama |
   | Automatizaciones en la nube | Clave de API |

   - Tiene cadena de respaldo.
   - Registra costos y cuotas.
   - El chat muestra qué modelo respondió.

## Consecuencias
- **Latencia:** el puente añade 1–3 s.
- **Cuotas:** el puente depende de las cuotas del plan.
- **Uso personal:** cada usuario usa su propia suscripción.
- **Sin nube:** no funciona desde Fossil Cloud.
- **Si Google cambia `agy`:** solo se actualiza el adaptador, y mientras tanto el router cae a la API.
- **El spike de R1 confirma:** flags, formato de streaming, configuración de MCP y soporte de ACP.
