# editor

**Propósito:** editor de bloques del cuerpo de los objetos, ligado al doc Yjs (ADR-0003),
con bloques referenciables por ID (ADR-0005) y escritura rápida en documentos grandes
(ADR-0015).

**Rutas:** `packages/editor` (`@fossil/editor`, issues #5, #23, #24, #25, #105):
- `src/editor.tsx`: `<FossilEditor />`, `getBodyFragment` y extensiones MIT (`StarterKit`, `TaskList`, `TaskItem`, `Callout`, `TABLE_EXTENSIONS`, `ImageAttachment`, `BlockId`, `Outliner`, `DragHandle`, `LinksExtension`, `EditorWordCount`, `SlashMenu`, `LinkAutocompleteMenu`).
- `src/transport.ts`: `DocTransport`, `SaveStatus` y `createUpdateBatcher` (agrupa `Y.mergeUpdates` cada 250 ms, encadena promesas y expone `status()`/`retry()`/`onStatusChange`, #164).
- `src/block-id.ts`: extensión `BlockId` (`data-block-id` con `crypto.randomUUID()` en bloques de primer nivel nuevos o divididos).
- `src/blocks.ts`: bloques `Callout` (`aside[data-type="callout"]`, atajos `>! `, `> ! `, `:::callout `) y tabla simple (`Table`, `TableRow`, `TableHeader`, `TableCell`, atajo `| col | ` y navegación `Tab`/`Shift-Tab`).
- `src/controls.tsx`: `DragHandle`, `moveTopBlock`/`moveCurrentTopBlock` (reordena bloques conservando `blockId`) y `<EditorWordCount />` (`countDocumentStats`, claves `editor.stats.words` y `editor.stats.characters`).
- `src/image-attachment.ts`: nodo de bloque `image` (`ImageAttachment`, #5) conectado a `saveAttachment`/`loadAttachment` en `DocTransport`; valida que `src` viva dentro de `attachments/<nombre>.<ext>` (`png`, `jpg`, `jpeg`, `gif`, `webp`) y guarda solo la ruta relativa en Yjs.
- `src/links.tsx`: `LinksExtension` y `<LinkAutocompleteMenu />` (#24: wikilinks `[[Título]]` con autocompletado, opción `"Crear «X»"` vía `onCreateObject`, apertura en pestaña nueva con `Ctrl+clic`/`Cmd+clic` vía `onOpenObject(target, { newTab: true })`, y autocompletado/decoración de tags `#etiqueta` y anidados `#marca/acme` conservados como texto plano en `Y.XmlText` para `fossil-core::indexer`).
  - **Formato con id** (#128): `[[<ObjectId>|<Título>]]` o `[[<ObjectId>#<blockId>|<Título>]]`. El id va **antes** de `|`; lo de después es alias visible. Se guarda como texto plano en `Y.XmlText`, igual que `[[Título]]`. Ver `docs/modules/objects.md` §Renombrado seguro.
  - **Títulos repetidos** (#137): `splitWikilink(value)` separa id y título. Con `ambiguousTitles` (títulos en minúsculas que comparten 2+ páginas), el menú `[[` muestra `[[Título]] · <hint>` e inserta la forma con id. Un `[[Título]]` escrito a mano y repetido lleva la clase `fossil-wikilink-ambiguous` y `data-ambiguous`, y al hacer clic abre el selector (`editor.wikilink.pick`), que lo reemplaza en su lugar. Nunca se abre la primera página en silencio. La decoración `fossil-wikilink-id` oculta `<ObjectId>|`: el chip se parte en varios `span` con el mismo `data-wikilink`. `refreshLinkDecorations(editor)` vuelve a marcar sin editar. La app (`apps/desktop/src/page-links.ts`) arma las sugerencias, los títulos repetidos, la apertura por id o por título único y «Crear».
- `src/outliner.ts`: extensión `Outliner` (#25: sangría `Tab`/`Shift+Tab` `indent` `0..6`, plegado de bloques/secciones `collapsed` y pegado limpio `cleanPastedHTML`/`cleanPastedText`).
- `src/code-block.ts` y `src/code-languages.ts` (#144): `CodeBlockLanguage` (`codeBlock` con selector de lenguaje y detección al pegar), `CODE_LANGUAGES`, `normalizeLanguage` y `detectLanguage`. `src/code-highlight.ts` (`CodeHighlight`, decoraciones inline) y `src/code-highlighter.ts` (motor Shiki, solo en diferido).
- `src/slash-menu.tsx` y `src/i18n.ts`: menú `/` filtrable con teclado y claves `editor.*` (`EditorTranslationKey`, `EditorTranslator`, `EDITOR_MESSAGES_ES_MX`, `EDITOR_MESSAGES_EN`) inyectables vía `t`.
- `styles/editor.css` (`@fossil/editor/styles.css`) y `src/playground.tsx` (`pnpm.cmd --filter @fossil/editor dev`, puerto 1430).
- El harness del spike vive en `apps/desktop/spike-editor/` (rama `spike/13-block-editor`; nunca se mergea).

**Contratos públicos:**
- `<FossilEditor doc={Y.Doc} transport={DocTransport} t?: EditorTranslator onSearchObjects? onCreateObject? onOpenObject? onSearchTags? onSaveStatusChange?: (status, retry) => void onReady?: (editor) => void />` con
  `interface DocTransport { load(): Promise<Uint8Array>; apply(update: Uint8Array): Promise<void>; saveAttachment?(fileName: string, bytes: Uint8Array): Promise<string>; loadAttachment?(path: string): Promise<Uint8Array> }`.
  La app conecta el transporte real a `object_load_doc` / `object_apply_update` y `attachment_save` / `attachment_load`; el paquete no depende de la persistencia.
- Cada bloque de primer nivel es un `Y.XmlElement` con atributo `blockId`
  (`crypto.randomUUID()`), reasignado por `BlockId` a todo nodo nuevo o duplicado.

**Estructura del doc Yjs (obligatoria):** el árbol debe reproducir el content model del
schema de TipTap — `paragraph`/`heading` → texto; `listItem` → `paragraph` → texto;
`blockquote`/`callout` → `paragraph` → texto; `horizontalRule` (hoja);
`table` → `tableRow` → `tableHeader`/`tableCell` → `paragraph` → texto. Si un elemento no calza, y-prosemirror lo **borra
del doc Yjs** sin error visible (spike #13: 758 de 5 000 bloques).

**Bloque de código (#144, para el espejo Markdown #148):** `codeBlock` → texto plano (sin marcas ni hijos). Atributos del `Y.XmlElement`: `language` (cadena o ausente/`null` = texto plano; id canónico de `CODE_LANGUAGES`, p. ej. `typescript`, `sql`, `bash`; un pegado desde VS Code puede traer alias como `ts`/`typescriptreact`: normalizar con `normalizeLanguage`), más `blockId`, `indent` y `collapsed` como en cualquier bloque. Mapeo sugerido a Markdown: ```` ```<language> ````.

**Gotchas (verificados en el spike #13 y en #23):**
- **Abrir no escribe:** `transport.load()` se aplica al `Y.Doc` antes de montar el binding `ySyncPlugin` y de suscribir `doc.on("update")`, y `BlockId` ignora transacciones con `ySyncPluginKey` para no disparar `apply` al abrir un cuerpo existente o vacío.
- TipTap 3: el hook de plugins es `addProseMirrorPlugins`; con el nombre de TipTap 2
  (`addProsemirrorPlugins`) el plugin se ignora en silencio y no hay sincronización.
- Enter hereda `blockId` del bloque original: sin reasignación quedan IDs duplicados.
- El coste por transacción es lineal con el número de bloques (~2.5 µs/bloque): con
  5 000 bloques una pulsación cuesta ~15 ms (límite del presupuesto de 16 ms). Para no romperlo, `DragHandle` mapea su `DecorationSet` (`prev.map`) cuando no cambian los bloques de primer nivel, `BlockId` toma vía rápida si `childCount` e IDs existentes se mantienen y `EditorWordCount` escucha `"update"` con conteo en una sola pasada sin `textBetween`.
- Undo/redo va con `Y.UndoManager`; el history de TipTap se desactiva (`undoRedo: false`). y-prosemirror lee `addToHistory` de la **última** transacción del lote: ningún `appendTransaction` (p. ej. `BlockId`) debe marcar `addToHistory: false`, o el pegado/Enter completo deja de ser deshacible (#77). Un bloque heredado sin ID queda sin ID tras deshacer hasta la siguiente edición.
- Mover bloques: `moveTopBranch`/`stepTopBranch` llevan la rama (bloque + siguientes con `indent` mayor, `branchEnd`) y reutilizan los nodos, así que los `blockId` no cambian; `moveTopBlock` sigue moviendo un solo bloque. `Alt+↑/↓`, el asa y el arrastre usan la rama. Las secciones de encabezado no se mueven como rama (solo `indent`).
- `createUpdateBatcher` expone `SaveStatus` (`Saved`, `Saving`, `Error` con `failed_seq` y `last_error`, #164) a partir de los deltas enviados frente a los confirmados, reencola el lote en orden de secuencia si `transport.apply` falla (para no romper el reloj lógico de Yjs ni reportar `Saved` tras un fallo; `retry()` persiste todos los updates pendientes), evita `Y.mergeUpdates` con un solo delta y hace `flush()` en `pagehide`/`dispose()`.
- En `cleanPastedHTML`, normaliza `\u00a0` en los nodos de texto del DOM antes de serializar `innerHTML` (que convierte `\u00a0` en `&nbsp;`), filtra controles de formulario salvo `input[type="checkbox"]` y acota `indent` a `[0, 6]` tanto en `parseHTML` como en `renderHTML`.
- Todas las claves de `EDITOR_MESSAGES_ES_MX`/`EDITOR_MESSAGES_EN` (`defaultEditorMessages`) deben ser propiedades propias enumerables (nunca en el prototipo) y existir en `apps/desktop/src/i18n/{es-MX,en}.json`.
- `DragHandle` identifica arrastres propios con el MIME `application/x-fossil-block-index` y limpia el índice en `dragend`; la regla `| a | b |` de `Table` reemplaza solo `$from.before($from.depth)` para no destruir contenedores padre.
- Shiki (MIT, `shiki/core` + motor JS sin WASM + tema de variables CSS): la gramática de cada lenguaje es un chunk propio; `code-highlighter.ts` no debe importarse de forma estática desde ningún otro módulo o el resaltador entra al chunk inicial (el test `code-highlight.test.tsx` lo vigila). Bloques de más de 20 000 caracteres no se resaltan. El resaltado son decoraciones: nada se guarda en el doc.
- Solo extensiones MIT; textos de UI en el namespace i18n `editor` (es-MX por defecto).
- **Updates malformados (#42):** `Y.applyUpdate` con bytes basura o truncados lanza sin
  aplicar a medias: el doc queda intacto y sigue usable. `Y.mergeUpdates` es tolerante con
  basura *a solas* (el payload fusionado explota al aplicarlo, p. ej. en Rust), pero basura
  mezclada con cualquier segundo update lanza dentro del `send()` del batcher y el error
  escapa del timer o `flush()` sin pasar por `onError` (solo cubre fallos de `apply`).

**Cómo probar:** `pnpm.cmd --filter @fossil/editor test` ejecuta los tests de Vitest para transporte, `BlockId`, menú `/`, atajos Markdown, ida y vuelta Yjs ↔ documento, convergencia de updates (desordenados, duplicados, malformados) y recarga de un cuerpo de 5 000 bloques; para regresiones de rendimiento, el harness del spike (`spike.ts` mide carga, tecleo, IDs y memoria con 5 000 bloques).

**ADRs relacionados:** [0003](../adr/0003-yjs-crdt.md), [0005](../adr/0005-object-model.md),
[0015](../adr/0015-block-editor.md)
