# ADR-0014: Orquestación por claude, carriles con dueño y merge en serie

- **Estado:** aceptado · **Fecha:** 2026-10-14 · **Área:** `area:infra`

## Contexto
Varios agentes (GLM en ZCode, Gemini en Antigravity, Claude Code) trabajaban a la vez, y cada uno mergeaba sus propios PRs con autorrevisión. Esto causó tres problemas:
- se mergeaban cambios que nunca se habían probado juntos;
- una revisión de código podía pasar por visual (#59);
- dos carriles editaban los mismos archivos (`app.tsx`, `lib.rs`, i18n).

Además, todos comentan desde la misma cuenta de GitHub, así que el login no identifica al agente.

## Decisión
1. **Un orquestador (`claude`)** despacha el trabajo en el issue de coordinación con comentarios `## Despacho (claude)` y es el **único que mergea**, de uno en uno, con `scripts/merge.ps1`.
2. **Nadie revisa su propio trabajo:**
   - claude revisa a los constructores (`zcode-a`, `zcode-b`) y a `antigravity`;
   - `antigravity` revisa a claude;
   - `antigravity-vision` revisa toda la UI.
3. **Identidad explícita:** cada PR lleva `**Agente:** <id>` y cada comentario empieza con `## <Tipo> (<agente>, <modelo>)`. Desde ADR-0016 se añade el harness: `(<agente>, <harness>, <modelo>)`, más las líneas `**Harness:**` y `**Modelo:**` en el PR. El gate (ADR-0012) solo acepta revisiones con ese encabezado y de un agente distinto al autor.
4. **Carriles con dueño de archivos** en `.github/lanes.json`:
   - los archivos calientes (`Cargo.toml`, `package.json`, `lib.rs`, `app.tsx`, `styles.css`…) solo admiten cambios aditivos;
   - todo cruce de carril lleva una sección "Cruce de carril" en el PR y el label `cross-lane`, que pone claude;
   - el editor vive en `packages/editor` y lo integra claude, para que shell y editor no se pisen.
5. **Freeze con `main` en rojo:** solo entra el PR con `fix:main`, que es responsabilidad de `antigravity`.
6. **Un `target` de Cargo compartido** (`CARGO_TARGET_DIR`) en la PC de trabajo, para no llenar el disco con un `target` por worktree.

## Consecuencias
- Hay más latencia, porque claude es un cuello de botella para mergear. A cambio, `main` solo recibe cambios probados juntos.
- El control de carril por script (huella de revisión, rutas de `lanes.json`) llega en la parte 2 del gate. Hasta entonces lo aplica claude al revisar.
- Codex y `zcode-vision` quedan inactivos; sus prompts se conservan como referencia.

## Alternativas consideradas
- **Cada agente mergea lo suyo (protocolo anterior):** es lo que produjo choques y merges sin revisión válida.
- **Merge queue de GitHub:** no está disponible en repos personales privados del plan Free.
