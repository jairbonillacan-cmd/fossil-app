# AGENTS.md: guía para agentes de IA y contribuidores

Fossil es una app de escritorio para Windows donde el trabajo de un equipo de marketing, e-commerce,
datos y redes vive en un solo grafo de páginas: notas, tareas, contenido con aprobaciones, datos de
la tienda y de anuncios, e IA con MCP. Es local-first y ligera: Tauri 2 + Rust + React. El nombre se
escribe **Fossil** en todo texto visible; los nombres de máquina van en minúsculas (`fossil-core`,
`@fossil/desktop`). Lee este archivo completo antes de tocar nada, y **no leas más de lo que tu
issue pide**.

## 1. Orientación (5 minutos)

| Lee | Para qué |
|---|---|
| `docs/OVERVIEW.md` | Qué es la app, para quién, conceptos |
| `docs/ARCHITECTURE.md` | Estado medido de `main`, capas, reglas de diseño, almacenamiento, IA |
| `docs/modules/<área>.md` | Mapa de tu módulo: archivos clave, contratos, trampas (≤80 líneas) |
| `docs/DEVELOPMENT.md` | Compilar, probar, capturas, depurar |
| `docs/DOD.md` | Checklist obligatorio de cada PR |
| `docs/PROTOCOL.md` | Cómo trabajan varios agentes a la vez: roles, carriles, identidad, handoff |
| `docs/FEATURES.md` · `docs/MILESTONES.md` | Qué funciones existen o vienen · releases, riesgos y diferidos |
| `docs/STATUS.md` | Qué funciona hoy, con números |
| `docs/adr/` · `docs/specs/` | Decisiones y su porqué · qué construir y cómo se acepta |
| `docs/GLOSSARY.md` · `docs/DESIGN.md` | Nombres de la interfaz · guía visual |

## 2. Mapa del workspace

```text
apps/desktop/src          React 19: shell, ajustes, pantalla de Espacio, exportar
apps/desktop/src-tauri    comandos IPC (commands/*.rs) y registro tauri-specta (lib.rs)
apps/desktop/src/bindings.ts   GENERADO desde Rust: el contrato entre capas; nunca a mano
crates/fossil-core        espacios, páginas, CRDT (yrs), SQLite + FTS5, copia en Markdown, bitácora
crates/fossil-ai          router de IA, proveedores, almacén de claves de Windows
crates/fossil-bridge      CLIs de IA locales como procesos hijo (esqueleto)
crates/fossil-mcp         cliente y servidor MCP (esqueleto)
crates/fossil-data        conectores y analítica (esqueleto)
crates/fossil-os          notificaciones, atajos globales, OCR (esqueleto)
crates/fossil-proto       contratos con la nube y el portal (esqueleto)
packages/editor           editor de bloques: TipTap 3 + Yjs, menú /, transporte al core
packages/ui               tokens de diseño, fuentes, componentes base
site/                     sitio público: lee ROADMAP.md y CHANGELOG.md
scripts/                  merge gate, perf, capturas, denylist
```

Cada crate y `apps/desktop` tienen su propio `AGENTS.md` corto. `.github/lanes.json` dice qué
archivos son de cada carril y cuáles son calientes.

## 3. Reglas de oro

1. **Nunca perder trabajo.** El CRDT en SQLite es la fuente de verdad; el `.md` es una copia. Rust
   de producción no hace `unwrap`/`expect` sin un comentario que lo justifique (`clippy.toml` los
   permite solo en tests). Toda entrada de archivos, IPC o MCP es hostil: valida antes de usar.
2. **Contratos primero.** `bindings.ts` y los tipos de `fossil-core` cambian solo en un issue
   `type:contract`. Si tu issue depende de un contrato sin mergear, no empieces. CI falla si
   `bindings.ts` no coincide con el Rust.
3. **Todo es una página; toda acción es una herramienta.** Lo nuevo entra al modelo de objetos
   (ADR-0005), y una acción de la paleta es la misma que usarán la IA y el MCP.
4. **Local y privado.** Nada escucha fuera de `127.0.0.1` y todo exige token. Las claves van al
   almacén de credenciales de Windows, nunca a archivos ni logs. Fossil jamás lee credenciales de
   otras apps o CLIs (ADR-0011). Lo destructivo o externo pide confirmación.
5. **Presupuestos medidos.** Instalador < 30 MB, arranque < 1.5 s, RAM en reposo < 200 MB,
   búsqueda en 10 000 páginas < 50 ms. `perf.yml` bloquea el PR que los rompa.
6. **Textos en i18n.** Ningún texto de interfaz en el código; es-MX por defecto, `en` completo.
   Los nombres visibles salen de `docs/GLOSSARY.md` (ADR-0017): **Espacio**, no "bóveda".
7. **Producto genérico.** Ni nombres de clientes, empresas reales o productos de terceros, ni rutas
   o datos personales, en código, tests, fixtures, docs, capturas o prompts. Usa Acme y "Mi equipo",
   rutas con `$env:USERPROFILE`. Las integraciones que conectamos (Shopify, GA4, Meta Ads…) sí se
   nombran. CI lo verifica con `scripts/check-denylist.ps1`.
8. **Verifica la UI con tus ojos.** Captura con `scripts/capture-window.ps1`, en claro y oscuro, y
   adjúntala al PR. Nada de controles de navegador sin estilo; paleta blanco y negro.
9. **Idioma.** Docs, issues y UI en español (es-MX); código, identificadores y commits en inglés.

## 4. Elegir trabajo

1. Lo que diga el último `## Despacho` del issue de coordinación fijado; si no dice nada,
   `gh issue list -l lane:<tu-carril> -l status:ready`.
2. Respeta "Depende de #n": si #n no está cerrado, no lo tomes.
3. Reclama: `gh issue edit <n> --add-label status:in-progress --remove-label status:ready` y comenta
   `## claim (<agente>, <harness>, <modelo>)`.
4. Aísla: `git fetch && git worktree add ../fossil-wt/<n> -b <agente>/<n>-<slug> origin/main`.
   Nunca trabajes en `main`.
5. Lee **solo** "Contexto a leer" del issue y `docs/modules/<área>.md`.

## 5. Antes de terminar

```powershell
pnpm.cmd check                                         # Biome + typecheck + Vitest
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
cargo nextest run --workspace                          # regenera bindings.ts si cambió un comando
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/check-denylist.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/perf.ps1   # si tocaste arranque, bundle o búsqueda
```

Luego, en el mismo PR: actualiza `docs/modules/<área>.md` si cambió un contrato o una trampa; crea
`docs/adr/NNNN-*.md` si tomaste una decisión de arquitectura (número reservado en el despacho);
añade la línea de `CHANGELOG.md` si la persona usuaria lo va a notar. Después `gh pr ready`,
label `needs:code-review` (más `needs:vision` y capturas si hay UI) y el issue a `status:review`.

## 6. PRs

- **Pequeños:** ≤400 líneas añadidas sin contar generados. Si crece, divide el issue.
- **Identidad (ADR-0016):** todos publicamos desde la misma cuenta. Cada comentario empieza con
  `## <Tipo> (<agente>, <harness>, <modelo>)`; cada PR lleva `**Agente:**`, `**Harness:**` y
  `**Modelo:**`; cada commit, el trailer `Agent: <agente> (<harness>, <modelo>)`. El rol lo da el
  id, no el modelo. El merge gate rechaza lo que no venga firmado.
- **Commits:** Conventional Commits (`feat(editor): …`), pequeños, con tests.
- **Revisión y merge:** revisa otro agente (`Veredicto: OK | CAMBIOS`); el orquestador mergea de uno
  en uno con `scripts/merge.ps1 <pr>`, que exige CI `ci` en verde, PR al día con `main`, revisión de
  otro agente y OK visual si hay UI (ADR-0012). Si pide rebase: `git rebase origin/main` y
  `git push --force-with-lease`.
- **Fuera de tu carril:** sección "Cruce de carril" en el PR; el label `cross-lane` lo pone el orquestador.
- **Si te interrumpes:** handoff en el issue (formato en `docs/PROTOCOL.md`), `status:handoff`, rama subida.

## 7. Agentes en paralelo

- Un carril por agente, máximo 3 constructores y 1 revisor visual a la vez.
- Un solo `target` para todos los worktrees: `CARGO_TARGET_DIR=$env:USERPROFILE\fossil-target`.
  Los carriles de TypeScript no compilan Rust salvo `pnpm.cmd dev` para capturas.
- Lockfiles y `bindings.ts` se regeneran, nunca se editan ni se resuelven a mano. Si
  `pnpm-lock.yaml` cambió sin que tocaras dependencias, descártalo.
- Si el cambio de otro rompe tu build, espera y reintenta; no arregles sus archivos.
- No cambies el alcance de un issue en silencio: coméntalo en el issue.
- No leas lockfiles, `target/`, `node_modules/`, `dist/`, binarios ni archivos generados.

## 8. Dónde se lleva el trabajo

- **GitHub es la fuente de verdad:** tareas = issues, releases = milestones (`R0`…`R7`, `Futuro`),
  estado = labels `status:*`. Nunca guardes estado de tareas en archivos del repo.
- `ROADMAP.md` y `CHANGELOG.md` son públicos (los publica `site/`): sin números de issue, nombres
  internos ni comparaciones. Sus reglas están en el comentario al inicio de cada archivo.
- `docs/STATUS.md` se actualiza al cerrar un release o cuando un número medido cambia.
- `docs/retro/R<n>.md`: retrospectiva de cada release.
