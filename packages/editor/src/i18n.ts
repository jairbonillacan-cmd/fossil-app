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
  | "editor.slash.table";

/** Translator function passed to `<FossilEditor t={t} />` by the host application. */
export type EditorTranslator = (key: EditorTranslationKey) => string;

/** Default Spanish (es-MX) strings for the `editor.*` namespace. */
export const EDITOR_MESSAGES_ES_MX: Readonly<Record<EditorTranslationKey, string>> = {
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
} as Record<EditorTranslationKey, string>;
Object.setPrototypeOf(EDITOR_MESSAGES_ES_MX, {
  "editor.outliner.collapse": "Plegar sección",
  "editor.outliner.expand": "Desplegar sección",
  "editor.slash.callout": "Bloque destacado",
  "editor.slash.horizontalRule": "Divisor",
  "editor.slash.table": "Tabla simple",
});

/** English (en) strings for the `editor.*` namespace. */
export const EDITOR_MESSAGES_EN: Readonly<Record<EditorTranslationKey, string>> = {
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
} as Record<EditorTranslationKey, string>;
Object.setPrototypeOf(EDITOR_MESSAGES_EN, {
  "editor.outliner.collapse": "Collapse section",
  "editor.outliner.expand": "Expand section",
  "editor.slash.callout": "Callout",
  "editor.slash.horizontalRule": "Divider",
  "editor.slash.table": "Simple table",
});

/** Fallback translator (es-MX) when the host does not pass `t`. */
export const defaultEditorTranslator: EditorTranslator = (key) => EDITOR_MESSAGES_ES_MX[key];
