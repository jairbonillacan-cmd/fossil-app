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

/** Outline sample for branch-move captures (`?plan=1`): two roots, each with indented children. */
const buildPlanUpdate = (): Uint8Array => {
  const doc = new Y.Doc();
  const plan: [string, number][] = [
    ["Campaña Acme", 0],
    ["Definir público", 1],
    ["Elegir canales", 1],
    ["Presupuesto", 0],
    ["Aprobar gasto", 1],
  ];
  getBodyFragment(doc).insert(
    0,
    plan.map(([text, indent], i) => textEl("paragraph", `blk_plan${i}`, text, { indent })),
  );
  return Y.encodeStateAsUpdate(doc);
};

/** Builds a deterministic, neutral sample Yjs document showcasing all alpha block types. */
const buildSampleUpdate = (openLinks = false): Uint8Array => {
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

  const box = (t: string, ch: Y.XmlElement[], id?: string) => {
    const el = new Y.XmlElement(t);
    if (id) setAttr(el, "blockId", id);
    if (ch.length) el.insert(0, ch);
    return el;
  };
  const row = (t: string, a: string, b: string) =>
    box("tableRow", [box(t, [pEl(a)]), box(t, [pEl(b)])]);

  getBodyFragment(doc).insert(0, [
    textEl("heading", "blk_h1", "Arquitectura del grafo local", { level: 1 }),
    textEl(
      "paragraph",
      "blk_intro",
      "Cada objeto almacena su cuerpo como un fragmento Yjs sincronizado con bloques identificados.",
    ),
    textEl("paragraph", "blk_out1", "Nivel 1: sangría con Tab y guía continua", { indent: 1 }),
    textEl("paragraph", "blk_out2", "Nivel 2: subbloque plegable en Yjs", { indent: 2 }),
    textEl("heading", "blk_h2_fold", "Notas archivadas (plegadas)", { level: 2, collapsed: true }),
    textEl("paragraph", "blk_hidden", "Oculto mientras la sección está plegada."),
    textEl("heading", "blk_h2", "Bloques de la versión alpha", { level: 2 }),
    bullets,
    tasks,
    quote,
    box("callout", [pEl("Bloque destacado monocromático sincronizado en Yjs.")], "blk_callout"),
    box("horizontalRule", [], "blk_hr"),
    box(
      "table",
      [row("tableHeader", "Métrica", "Presupuesto"), row("tableCell", "Tecleo p95", "≤ 16 ms")],
      "blk_table",
    ),
    textEl(
      "paragraph",
      "blk_links",
      "Referencias [[Arquitectura del grafo local]] en #marca/acme.",
    ),
    textEl(
      "codeBlock",
      "blk_code",
      'const body = doc.getXmlFragment("body");\nY.applyUpdate(doc, snapshot);',
      { language: "typescript" },
    ),
    textEl("paragraph", "blk_slash", openLinks ? "Enlazar [[Campaña Acme" : "/enc"),
  ]);
  return Y.encodeStateAsUpdate(doc);
};

const SAMPLE_OBJECTS = [
  { id: "1", title: "Arquitectura del grafo local" },
  { id: "2", title: "Campaña Acme Q4" },
] as const;

function PlaygroundApp() {
  const params = new URLSearchParams(window.location.search);
  document.documentElement.setAttribute(
    "data-theme",
    params.get("theme") === "dark" ? "dark" : "light",
  );
  const openLinks = params.get("links") === "1";
  const plan = params.get("plan") === "1";
  const openMenu = !plan && (openLinks || params.get("slash") !== "0");

  const doc = useMemo(() => new Y.Doc(), []);
  const transport = useMemo<DocTransport>(
    () => ({
      load: async () => (plan ? buildPlanUpdate() : buildSampleUpdate(openLinks)),
      apply: async () => {},
    }),
    [openLinks, plan],
  );

  const handleReady = (editor: Editor) => {
    if (plan) editor.commands.focus("start");
    else if (openMenu) editor.commands.setTextSelection(editor.state.doc.content.size - 1);
  };

  return (
    <main
      id="editor-surface"
      style={{
        boxSizing: "border-box",
        maxWidth: "680px",
        margin: "0 auto",
        padding: "24px 32px 24px 56px",
        background: "var(--bg)",
        color: "var(--fg)",
      }}
    >
      <FossilEditor
        doc={doc}
        transport={transport}
        onReady={handleReady}
        onSearchObjects={() => SAMPLE_OBJECTS}
      />
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
