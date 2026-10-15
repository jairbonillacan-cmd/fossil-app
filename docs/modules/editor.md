# editor

**Propósito:** editor de bloques del cuerpo de los objetos, ligado al doc Yjs (ADR-0003),
con bloques referenciables por ID (ADR-0005) y escritura rápida en documentos grandes
(ADR-0015).

**Rutas:** `packages/editor` (`@fossil/editor`, issues #23, #24, #25, #105):
- `src/editor.tsx`: `<FossilEditor />`, `getBodyFragment` y extensiones MIT (`StarterKit`, `TaskList`, `TaskItem`, `Callout`, `TABLE_EXTENSIONS`, `BlockId`, `Outliner`, `DragHandle`, `LinksExtension`, `EditorWordCount`, `SlashMenu`, `LinkAutocompleteMenu`).
- `src/transport.ts`: `DocTransport` y `createUpdateBatcher` (agrupa `Y.mergeUpdates` cada 250 ms y encadena promesas).
- `src/block-id.ts`: extensión `BlockId` (`data-block-id` con `crypto.randomUUID()` en bloques de primer nivel nuevos o divididos).
- `src/blocks.ts`: bloques `Callout` (`aside[data-type="callout"]`, atajos `>! `, `> ! `, `:::callout `) y tabla simple (`Table`, `TableRow`, `TableHeader`, `TableCell`, atajo `| col | ` y navegación `Tab`/`Shift-Tab`).
- `src/controls.tsx`: `DragHandle`, `moveTopBlock`/`moveCurrentTopBlock` (reordena bloques conservando `blockId`) y `<EditorWordCount />` (`countDocumentStats`, claves `editor.stats.words` y `editor.stats.characters`).
- `src/links.tsx`: `LinksExtension` y `<LinkAutocompleteMenu />` (#24: wikilinks `[[Título]]` con autocompletado, opción `"Crear «X»"` vía `onCreateObject`, apertura en pestaña nueva con `Ctrl+clic`/`Cmd+clic` vía `onOpenObject(target, { newTab: true })`, y autocompletado/decoración de tags `#etiqueta` y anidados `#marca/acme` conservados como texto plano en `Y.XmlText` para `fossil-core::indexer`).
- `src/outliner.ts`: extensión `Outliner` (#25: sangría `Tab`/`Shift+Tab` `indent` `0..6`, plegado de bloques/secciones `collapsed` y pegado limpio `cleanPastedHTML`/`cleanPastedText`).
- `src/slash-menu.tsx` y `src/i18n.ts`: menú `/` filtrable con teclado y claves `editor.*` (`EditorTranslationKey`, `EditorTranslator`, `EDITOR_MESSAGES_ES_MX`, `EDITOR_MESSAGES_EN`) inyectables vía `t`.
- `styles/editor.css` (`@fossil/editor/styles.css`) y `src/playground.tsx` (`pnpm.cmd --filter @fossil/editor dev`, puerto 1430).
- El harness del spike vive en `apps/desktop/spike-editor/` (rama `spike/13-block-editor`; nunca se mergea).

**Contratos públicos:**
- `<FossilEditor doc={Y.Doc} transport={DocTransport} t?: EditorTranslator onSearchObjects? onCreateObject? onOpenObject? onSearchTags? onReady?: (editor) => void />` con
  `interface DocTransport { load(): Promise<Uint8Array>; apply(update: Uint8Array): Promise<void> }`.
  La app conecta el transporte real a `object_load_doc` / `object_apply_update`; el paquete no depende de la persistencia.
- Cada bloque de primer nivel es un `Y.XmlElement` con atributo `blockId`
  (`crypto.randomUUID()`), reasignado por `BlockId` a todo nodo nuevo o duplicado.

**Estructura del doc Yjs (obligatoria):** el árbol debe reproducir el content model del
schema de TipTap — `paragraph`/`heading` → texto; `listItem` → `paragraph` → texto;
`blockquote`/`callout` → `paragraph` → texto; `horizontalRule` (hoja);
`table` → `tableRow` → `tableHeader`/`tableCell` → `paragraph` → texto. Si un elemento no calza, y-prosemirror lo **borra
del doc Yjs** sin error visible (spike #13: 758 de 5 000 bloques).

**Gotchas (verificados en el spike #13 y en #23):**
- **Abrir no escribe:** `transport.load()` se aplica al `Y.Doc` antes de montar el binding `ySyncPlugin` y de suscribir `doc.on("update")`, y `BlockId` ignora transacciones con `ySyncPluginKey` para no disparar `apply` al abrir un cuerpo existente o vacío.
- TipTap 3: el hook de plugins es `addProseMirrorPlugins`; con el nombre de TipTap 2
  (`addProsemirrorPlugins`) el plugin se ignora en silencio y no hay sincronización.
- Enter hereda `blockId` del bloque original: sin reasignación quedan IDs duplicados.
- El coste por transacción es lineal con el número de bloques (~2.5 µs/bloque): con
  5 000 bloques una pulsación cuesta ~15 ms (límite del presupuesto de 16 ms).
- Undo/redo va con `Y.UndoManager`; el history de TipTap se desactiva (`undoRedo: false`).
- Solo extensiones MIT; textos de UI en el namespace i18n `editor` (es-MX por defecto).

**Cómo probar:** `pnpm.cmd --filter @fossil/editor test` ejecuta los tests de Vitest para transporte, `BlockId`, menú `/`, atajos Markdown e ida y vuelta Yjs ↔ documento; para regresiones de rendimiento, el harness del spike (`spike.ts` mide carga, tecleo, IDs y memoria con 5 000 bloques).

**ADRs relacionados:** [0003](../adr/0003-yjs-crdt.md), [0005](../adr/0005-object-model.md),
[0015](../adr/0015-block-editor.md)
