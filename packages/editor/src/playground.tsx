import type { Editor } from "@tiptap/core";
import { StrictMode, useMemo } from "react";
import { createRoot } from "react-dom/client";
import * as Y from "yjs";
import { FossilEditor, getBodyFragment } from "./editor";
import type { DocTransport } from "./transport";

type AttrValue = string | number | boolean;

const setAttr = (el: Y.XmlElement, key: string, value: AttrValue) => {
  (el as Y.XmlElement<{ [k: string]: AttrValue }>).setAttribute(key, value);
};

const pEl = (text: string): Y.XmlElement => {
  const p = new Y.XmlElement("paragraph");
  const t = new Y.XmlText();
  t.insert(0, text);
  p.insert(0, [t]);
  return p;
};

const textEl = (tag: string, id: string, text: string, attrs: Record<string, AttrValue> = {}) => {
  const el = new Y.XmlElement(tag);
  setAttr(el, "blockId", id);
  for (const [k, v] of Object.entries(attrs)) setAttr(el, k, v);
  const t = new Y.XmlText();
  t.insert(0, text);
  el.insert(0, [t]);
  return el;
};

/** Builds a deterministic, neutral sample Yjs document showcasing all alpha block types. */
const buildSampleUpdate = (): Uint8Array => {
  const doc = new Y.Doc();
  const bullets = new Y.XmlElement("bulletList");
  setAttr(bullets, "blockId", "blk_ul");
  bullets.insert(
    0,
    [
      "Sincronización local agrupada cada 250 ms",
      "Identificadores estables por bloque al dividir líneas",
    ].map((line) => {
      const li = new Y.XmlElement("listItem");
      li.insert(0, [pEl(line)]);
      return li;
    }),
  );

  const tasks = new Y.XmlElement("taskList");
  setAttr(tasks, "blockId", "blk_tasks");
  tasks.insert(
    0,
    (
      [
        [true, "Definir el contrato DocTransport con almacenamiento"],
        [false, "Conectar atajos Markdown y menú de comandos"],
      ] as const
    ).map(([done, label]) => {
      const item = new Y.XmlElement("taskItem");
      setAttr(item, "checked", done);
      item.insert(0, [pEl(label)]);
      return item;
    }),
  );

  const quote = new Y.XmlElement("blockquote");
  setAttr(quote, "blockId", "blk_quote");
  quote.insert(0, [
    pEl("La estructura del documento reproduce el esquema para preservar cada nodo."),
  ]);

  getBodyFragment(doc).insert(0, [
    textEl("heading", "blk_h1", "Arquitectura del grafo local", { level: 1 }),
    textEl(
      "paragraph",
      "blk_intro",
      "Cada objeto almacena su cuerpo como un fragmento Yjs sincronizado con bloques identificados.",
    ),
    textEl("heading", "blk_h2", "Bloques de la versión alpha", { level: 2 }),
    bullets,
    tasks,
    quote,
    textEl(
      "codeBlock",
      "blk_code",
      'const body = doc.getXmlFragment("body");\nY.applyUpdate(doc, snapshot);',
    ),
    textEl("paragraph", "blk_slash", "/enc"),
  ]);
  return Y.encodeStateAsUpdate(doc);
};

function PlaygroundApp() {
  const params = new URLSearchParams(window.location.search);
  document.documentElement.setAttribute(
    "data-theme",
    params.get("theme") === "dark" ? "dark" : "light",
  );
  const openSlash = params.get("slash") !== "0";

  const doc = useMemo(() => new Y.Doc(), []);
  const transport = useMemo<DocTransport>(
    () => ({ load: async () => buildSampleUpdate(), apply: async () => {} }),
    [],
  );

  const handleReady = (editor: Editor) => {
    if (openSlash) editor.commands.setTextSelection(editor.state.doc.content.size - 1);
  };

  return (
    <main
      id="editor-surface"
      style={{
        boxSizing: "border-box",
        maxWidth: "680px",
        margin: "0 auto",
        padding: "24px 32px",
        background: "var(--bg)",
        color: "var(--fg)",
      }}
    >
      <FossilEditor doc={doc} transport={transport} onReady={handleReady} />
    </main>
  );
}

const rootEl = document.getElementById("root");
if (rootEl !== null) {
  document.body.style.margin = "0";
  document.body.style.background = "var(--bg)";
  createRoot(rootEl).render(
    <StrictMode>
      <PlaygroundApp />
    </StrictMode>,
  );
}
