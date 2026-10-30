/** Translation keys under the `editor.*` namespace (Despacho #3, issue #23). */
export type EditorTranslationKey =
  | "editor.slash.label"
  | "editor.slash.empty"
  | "editor.slash.paragraph"
  | "editor.slash.heading1"
  | "editor.slash.heading2"
  | "editor.slash.heading3"
  | "editor.slash.bulletList"
  | "editor.slash.orderedList"
  | "editor.slash.taskList"
  | "editor.slash.blockquote"
  | "editor.slash.codeBlock"
  | "editor.placeholder"
  | "editor.outliner.collapse"
  | "editor.outliner.expand"
  | "editor.slash.callout"
  | "editor.slash.horizontalRule"
  | "editor.slash.table"
  | "editor.drag.handle"
  | "editor.stats.words"
  | "editor.stats.characters"
  | "editor.wikilink.label"
  | "editor.wikilink.create"
  | "editor.wikilink.pick"
  | "editor.wikilink.ambiguous"
  | "editor.tag.label"
  | "editor.image.alt"
  | "editor.image.loading"
  | "editor.image.error"
  | "editor.code.language"
  | "editor.code.plain";

/** Translator function passed to `<FossilEditor t={t} />` by the host application. */
export type EditorTranslator = (key: EditorTranslationKey) => string;

/** Catalog mapping every `editor.*` translation key to its localized string. */
export type EditorMessages = Readonly<Record<EditorTranslationKey, string>>;

/** Default Spanish (es-MX) strings for the `editor.*` namespace. */
export const EDITOR_MESSAGES_ES_MX: EditorMessages = {
  "editor.slash.label": "Comandos de bloque",
  "editor.slash.empty": "Sin bloques coincidentes",
  "editor.slash.paragraph": "Texto",
  "editor.slash.heading1": "Encabezado 1",
  "editor.slash.heading2": "Encabezado 2",
  "editor.slash.heading3": "Encabezado 3",
  "editor.slash.bulletList": "Lista con viñetas",
  "editor.slash.orderedList": "Lista numerada",
  "editor.slash.taskList": "Lista de tareas",
  "editor.slash.blockquote": "Cita",
  "editor.slash.codeBlock": "Bloque de código",
  "editor.placeholder": "Escribe algo o pulsa «/» para insertar un bloque",
  "editor.outliner.collapse": "Plegar sección",
  "editor.outliner.expand": "Desplegar sección",
  "editor.slash.callout": "Bloque destacado",
  "editor.slash.horizontalRule": "Divisor",
  "editor.slash.table": "Tabla simple",
  "editor.drag.handle": "Arrastrar para reordenar bloque",
  "editor.stats.words": "palabras",
  "editor.stats.characters": "caracteres",
  "editor.wikilink.label": "Enlazar objeto",
  "editor.wikilink.create": "Crear",
  "editor.wikilink.pick": "Elige la página",
  "editor.wikilink.ambiguous": "Varias páginas tienen este título: haz clic para elegir una",
  "editor.tag.label": "Etiquetas",
  "editor.image.alt": "Imagen adjunta",
  "editor.image.loading": "Cargando imagen…",
  "editor.image.error": "No se pudo cargar la imagen",
  "editor.code.language": "Lenguaje del bloque de código",
  "editor.code.plain": "Texto plano",
};

/** Default (es-MX) message catalog with all enumerable keys. */
export const defaultEditorMessages: EditorMessages = EDITOR_MESSAGES_ES_MX;

/** English (en) strings for the `editor.*` namespace. */
export const EDITOR_MESSAGES_EN: EditorMessages = {
  "editor.slash.label": "Block commands",
  "editor.slash.empty": "No matching blocks",
  "editor.slash.paragraph": "Text",
  "editor.slash.heading1": "Heading 1",
  "editor.slash.heading2": "Heading 2",
  "editor.slash.heading3": "Heading 3",
  "editor.slash.bulletList": "Bullet list",
  "editor.slash.orderedList": "Numbered list",
  "editor.slash.taskList": "Task list",
  "editor.slash.blockquote": "Quote",
  "editor.slash.codeBlock": "Code block",
  "editor.placeholder": "Type something or press “/” to insert a block",
  "editor.outliner.collapse": "Collapse section",
  "editor.outliner.expand": "Expand section",
  "editor.slash.callout": "Callout",
  "editor.slash.horizontalRule": "Divider",
  "editor.slash.table": "Simple table",
  "editor.drag.handle": "Drag to reorder block",
  "editor.stats.words": "words",
  "editor.stats.characters": "characters",
  "editor.wikilink.label": "Link object",
  "editor.wikilink.create": "Create",
  "editor.wikilink.pick": "Choose the page",
  "editor.wikilink.ambiguous": "Several pages share this title: click to choose one",
  "editor.tag.label": "Tags",
  "editor.image.alt": "Attached image",
  "editor.image.loading": "Loading image…",
  "editor.image.error": "Could not load image",
  "editor.code.language": "Code block language",
  "editor.code.plain": "Plain text",
};

/** Fallback translator (es-MX) when the host does not pass `t`. */
export const defaultEditorTranslator: EditorTranslator = (key) => EDITOR_MESSAGES_ES_MX[key];
