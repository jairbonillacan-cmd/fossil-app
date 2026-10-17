# Protocolo Fossil: cómo trabajan los agentes

`AGENTS.md` es el resumen operativo. Este documento explica el porqué y cubre los casos especiales.

## Roles
| Rol | Quién | Hace |
|---|---|---|
| Product owner | @jairbonillacan-cmd | Decide producto, prioridades y alcance. **No** instala, revisa ni mergea |
| Orquestador | `claude` (Claude Code) o `antigravity-orchestrator` (Antigravity) cuando Claude no está | Planifica, despacha en el issue de coordinación, reserva números de ADR, revisa el código de los demás y es el **único que mergea** (ADR-0014). También lleva los carriles core/storage e infra y, con subagentes constructores de Claude Code que firman como `claude` (solo `claude-review` y `claude-vision` usan otro id para revisar), construye en shell y editor cuando el despacho se lo asigna (aprobado por el PO el 2026-10-16) |
| Constructores | `zcode-a`, `zcode-b` (ZCode, GLM) · `antigravity`, `antigravity-b`, `antigravity-search`, `antigravity-ai` (Antigravity, Gemini) · `claude` (Claude Code) | Toman los issues de su carril y entregan PRs; no mergean |
| Sitio público | `antigravity-site` (Antigravity) | Construye y mantiene el sitio público (`site/`, carril `site`); no mergea |
| Bugs y errores | `antigravity` / `antigravity-c` (Antigravity, Gemini) | Arregla `main` en rojo y la cola `type:bug` |
| Revisor visual | `antigravity-vision` (Antigravity, sesión aparte) o `claude-vision` (agente de Claude Code con contexto limpio, lanzado por el orquestador) | Revisa capturas contra `DESIGN.md` y hace QA visual; no escribe código |

**Nadie revisa su propio trabajo:** el revisor (`claude-review`, `antigravity-review` o `claude`) siempre tiene un id de agente distinto del autor del PR, y `antigravity-vision` / `claude-vision` revisan toda la UI. El gate lo comprueba con la línea `**Agente:** <id>` del PR y el encabezado de cada revisión (ver § Identidad).

**Autonomía:** los agentes instalan toolchains y dependencias. Solo escalan al PO decisiones de producto o de alcance, gastos y accesos a cuentas externas (Meta, Google, Shopify, firma de código).

## Identidad (ADR-0016)
Todos publicamos desde la misma cuenta de GitHub, así que cada mensaje dice **quién** lo escribe, **con qué herramienta** y **con qué modelo**. Sin excepciones: comentarios, PRs, handoffs, despachos y commits.

| Dato | Qué es | Valores |
|---|---|---|
| **Agente** | El **rol**. Lo usa el gate (autor ≠ revisor, revisores visuales, carriles) | `claude`, `antigravity-orchestrator`, `antigravity`, `antigravity-b`, `antigravity-c`, `antigravity-review`, `antigravity-search`, `antigravity-ai`, `antigravity-site`, `antigravity-vision`, `claude-vision`, `claude-review`, `zcode-a`, `zcode-b`, `zcode-vision` (los constructores están en `lanes.<carril>.agents` de `.github/lanes.json`) |
| **Harness** | La herramienta que ejecuta al modelo | `Claude Code`, `Antigravity`, `ZCode`, `Codex CLI`. Una herramienta nueva se añade aquí |
| **Modelo** | El modelo real de **esta** sesión, tal como lo muestra el harness | `Opus 5.5`, `Gemini 4 Argon`, `Gemini 3.8 Flash`, `GLM 5.3`… |

**Formatos:**
- **Comentarios:** la primera línea es `## <Tipo> (<agente>, <harness>, <modelo>)`.
  - `## claim (antigravity-c, Antigravity, Gemini 3.8 Flash)`
  - `## Revisión de código (claude, Claude Code, Opus 5.5)`
  - `## Revisión visual (antigravity-vision, Antigravity, Gemini 3.8 Flash)`
  - `## Despacho (antigravity-orchestrator, Antigravity, Gemini 4 Argon) #12`
- **PRs:** al final del cuerpo, tres líneas, cada una al inicio de línea:
  ```
  **Agente:** antigravity-c
  **Harness:** Antigravity
  **Modelo:** Gemini 3.8 Flash
  ```
- **Commits:** trailer al final del mensaje, `Agent: antigravity-c (Antigravity, Gemini 3.8 Flash)`.
- **Handoff:** el encabezado `## Handoff (<agente>, <harness>, <modelo>)`.

**Reglas:**
- **El rol lo da el id, no el modelo.** En otra PC, o si se acaba la cuota del modelo grande, la misma sesión sigue con su id y firma con el modelo que use de verdad. No inventes ids nuevos por modelo.
- **Si cambias de modelo a mitad de un trabajo,** firma con el nuevo desde ese momento. Actualiza la línea `**Modelo:**` del PR si a partir de ahí escribes la mayor parte. No edites comentarios ya publicados.
- **El merge gate lo exige y falla cerrado:**
  - un PR sin `**Harness:**` / `**Modelo:**` se rechaza;
  - una revisión publicada desde el 2026-10-15 sin harness y modelo **bloquea** el merge hasta que se publique bien firmada;
  - las revisiones anteriores conservan el formato antiguo `(<agente>, <modelo>)`.
- **Capacidad mínima por rol:**
  - un revisor visual necesita un modelo que vea imágenes y pasa la prueba de visión de su prompt;
  - los contratos y el gate se revisan con un modelo frontera;
  - si solo hay modelos chicos, el orquestador no mergea `type:contract`.

## Flujo: spec → contrato → spike → issues → código
1. **Spec** (`docs/specs/<feature>.md`) con qué, por qué, criterios de aceptación, fuera de alcance y riesgos. El PO la aprueba.
2. **Contrato** (issue `type:contract`) con los tipos Rust/TS, los comandos IPC y el esquema SQL. Se mergea **antes** de abrir el trabajo en paralelo, para que dos agentes no inventen interfaces distintas.
3. **Spike** (`type:spike`) con tiempo fijo de 1–2 días si hay riesgo técnico. Entrega un ADR o una nota con la conclusión; el código del spike puede tirarse.
4. **Issues** de tamaño `size:S` (< ½ día) o `size:M` (1–2 días). Un issue L se divide antes de empezar.
5. **Código** con el ciclo de `AGENTS.md`.

## Anatomía de un buen issue
Usa la plantilla `feature.yml`. Lleva estas secciones:
- **Objetivo:** una frase.
- **Contexto a leer:** lista exacta de archivos y docs. Esto es lo que ahorra tokens: el agente no explora el repo.
- **Criterios de aceptación:** una lista verificable.
- **Fuera de alcance.**
- **Depende de:** `#n`.
- **Cómo verificar:** comandos o pasos concretos.

## Etiquetas
| Grupo | Valores |
|---|---|
| `status:` | `ready` · `in-progress` · `handoff` · `review` · `blocked` |
| `type:` | `feat` · `bug` · `contract` · `spike` · `docs` · `chore` · `perf` |
| `area:` | `editor` · `objects` · `storage` · `views` · `tasks` · `content` · `approvals` · `commerce` · `data` · `ai` · `mcp` · `sync` · `cloud` · `portal` · `os` · `ui` · `infra` · `site` |
| `agent:` | `claude` · `zcode` · `antigravity` · `antigravity-vision` · `human` (`codex`, inactivo) |
| `lane:` | `core` · `infra` · `shell` · `editor` · `bugs` · `search` · `ai` · `site` |
| `needs:` | `code-review` · `vision` |
| otros | `cross-lane` · `fix:main` |
| `size:` | `S` · `M` |

Los issues `status:blocked` dicen en un comentario qué los bloquea. Los `type:chore` que son trámites del PO (Meta, Google, firma de código) llevan además `agent:human`.

## Ramas, worktrees y PRs
- Rama: `<agente>/<issue>-<slug>`, por ejemplo `codex/42-fts-index`.
- Cada agente usa su propio worktree en `../fossil-wt/<issue>`, y nunca dos agentes en el mismo.
- Commits en formato Conventional Commits; los PRs se hacen squash-merge en `main`.
- Abre el PR en draft desde el primer commit útil, para que otros vean tu avance.
- Al mergear, el autor borra su worktree: `git worktree remove ../fossil-wt/<n>`.

## Handoff (cuando un agente se detiene)
Comenta en el issue con este formato y cambia a `status:handoff`:
```
## Handoff (<agente>, <harness>, <modelo>)
**Rama:** <rama> (subida)
**Hecho:** …
**Pendiente:** …
**Decisiones:** …
**Cómo verificar lo hecho:** …
**Siguiente paso concreto:** …
```
El siguiente agente reclama el issue, hace checkout de esa rama en su worktree y continúa.

## Varios agentes a la vez: carriles
- El orquestador reparte los issues en **carriles**: secuencias de issues de una misma área que tocan archivos distintos de los demás carriles.
- Cada carril tiene **un** agente, un worktree y una rama por issue. Máximo 3 constructores + 1 revisor visual.
- **Dueños de archivos:** `.github/lanes.json` lista las rutas de cada carril y los archivos calientes (`Cargo.toml`, `package.json`, `lib.rs`, `app.tsx`…). Fuera de tu carril: sección "Cruce de carril" en el PR y label `cross-lane` (solo claude).
- **Despacho:** el último comentario `## Despacho (<orquestador>, <harness>, <modelo>)` en el issue de coordinación fijado manda sobre cualquier prompt: qué hace cada agente, en qué orden y qué está bloqueado.
- **Merge en serie:** claude mergea de uno en uno; cada PR debe estar al día con `main` y verde sobre esa base. Si `main` se pone en rojo, todo se congela salvo el PR `fix:main`.
- Un PR con UI necesita el "OK" de `antigravity-vision` antes del merge.
- **Lockfiles en conflicto:** se regeneran (`pnpm install` / `cargo update -w`), nunca se resuelven a mano.

## Conflictos y coordinación
- Si dos issues tocan el mismo archivo, el planificador los marca con "Depende de" para que vayan en secuencia.
- Si descubres que necesitas cambiar un contrato, **no lo cambies dentro de tu PR**. Abre un issue `type:contract` y pon el tuyo en `status:blocked`.
- Si encuentras trabajo fuera de alcance, abre un issue nuevo (`status:ready` solo si es obvio; si no, sin status para que el PO lo triaje).

## Ahorro de tokens
- `AGENTS.md` raíz de ≤150 líneas; cada carpeta grande tiene su propio `AGENTS.md` breve.
- `docs/modules/<area>.md` de ≤80 líneas: el mapa del módulo, no una novela.
- Los tipos TS se generan desde Rust (tauri-specta), así que no hace falta leer Rust para conocer un contrato.
- Usa `rg` y `gh … --json` con campos concretos. No leas lockfiles ni builds.
- `FEATURES.md` y `ARCHITECTURE.md` son largos: léelos solo si eres el planificador o si tu issue cita una sección (`FEATURES.md` §8).

## Cierre de release
1. Todos los issues del milestone cerrados o movidos (con motivo).
2. Instalador generado en CI e instalado por el PO.
3. Demo grabada y retrospectiva en `docs/retro/R<n>.md` (qué salió bien, qué no, qué ajustar).
4. El planificador actualiza `MILESTONES.md` y `FEATURES.md` si cambió el alcance y prepara las specs e issues del siguiente release.
