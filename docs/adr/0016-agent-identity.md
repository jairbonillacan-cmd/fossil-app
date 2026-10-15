# ADR-0016: Identidad de los agentes (agente, harness y modelo)

- **Estado:** aceptado (2026-10-14, pedido del PO)
- **Relacionado:** ADR-0012 (merge gate), ADR-0014 (orquestación y carriles)

## Contexto
Todos los agentes publican desde la misma cuenta de GitHub. Hasta hoy se identificaban con `## <Tipo> (<agente>, <modelo>)` y la línea `**Agente:** <id>` en los PRs. Esto deja dos huecos:
- **En otra PC cambia el modelo.** El mismo rol (`antigravity-vision`) puede correr con Gemini 4 Argon en una PC y con Gemini 3.8 Flash en otra. Los prompts fijaban el modelo, así que una sesión con otro modelo firmaba con un nombre falso o no sabía cómo firmar.
- **No queda registro del harness**, la herramienta que ejecuta al modelo (Claude Code, Antigravity, ZCode…). Sin él no se puede auditar qué combinación produjo un PR o una revisión, ni comparar calidad entre modelos, ni saber qué permisos y herramientas tenía (por ejemplo, si podía ver imágenes).

## Decisión
1. **El rol lo da el id del agente, no el modelo.** `antigravity-vision` es un rol. Cualquier sesión que lo cumpla, con cualquier modelo capaz, firma con ese id. El gate sigue decidiendo solo por el id (`$VisionAgents`, autor ≠ revisor).
2. **Toda firma lleva los tres datos:**
   - **Comentarios:** `## <Tipo> (<agente>, <harness>, <modelo>)`. Ejemplo: `## Revisión visual (antigravity-vision, Antigravity, Gemini 3.8 Flash)`.
   - **PRs:** tres líneas al final del cuerpo:
     ```
     **Agente:** antigravity-c
     **Harness:** Antigravity
     **Modelo:** Gemini 3.8 Flash
     ```
   - **Commits:** trailer `Agent: <agente> (<harness>, <modelo>)`. Recomendado, no lo exige el gate. Claude Code añade además su `Co-Authored-By`.
3. **Nombres canónicos de harness:** `Claude Code`, `Antigravity`, `ZCode` y `Codex CLI`. Una herramienta nueva se añade a la tabla de `docs/PROTOCOL.md` § Identidad.
4. **Modelo:** el nombre que muestra el harness, sin abreviar (`Opus 5.5`, `Gemini 4 Argon`, `Gemini 3.8 Flash`, `GLM 5.3`). Si la sesión cambia de modelo a mitad de trabajo, desde ese momento firma con el nuevo. Lo ya publicado no se edita.
5. **El merge gate lo exige y falla cerrado** (`scripts/merge.ps1`):
   - Un PR sin `**Harness:**` o `**Modelo:**` (o con el placeholder `<!-- -->` de la plantilla) se rechaza.
   - Una revisión publicada desde el **2026-10-15 00:00 UTC** sin harness y modelo en el encabezado **rechaza el merge**, no se ignora. Así, un `CAMBIOS` mal firmado nunca deja pasar un OK anterior. El revisor la vuelve a publicar bien.
   - Las revisiones anteriores a esa fecha conservan el formato antiguo `(<agente>, <modelo>)`.
   - El mensaje de OK del gate nombra al autor y a los revisores con su harness y modelo, para que quede en el registro del merge.
6. **Capacidades mínimas por rol**:
   - **Revisión visual:** el modelo debe aceptar imágenes. El prompt obliga a una prueba de visión antes de la primera revisión.
   - **Contratos y gate:** un modelo frontera.

## Consecuencias
- Los PRs abiertos antes de este ADR necesitan las dos líneas nuevas en su cuerpo antes del merge (`gh pr edit <n> --body-file …`). Es una edición de texto y no vuelve a correr CI.
- Se puede auditar y comparar el trabajo por modelo y por harness con `gh` (buscar en los encabezados).
- Cambiar de modelo, por ejemplo Flash en otra PC, no requiere tocar el gate ni los prompts: solo firmar con el modelo real.
- **Riesgo:** un agente puede firmar con datos falsos. Es el mismo riesgo que ya existía con el id. La defensa sigue siendo que cada sesión tiene su propio prompt y que el orquestador revisa.

## Alternativas descartadas
- **Un id por combinación** (`antigravity-vision-flash`): multiplica los ids del gate y de `lanes.json` sin aportar nada; el rol no cambia.
- **Solo documentar, sin que el gate lo exija:** las convenciones sin control se pierden en una semana (ya pasó con `**Agente:**` antes de ADR-0012).
