import { Editor } from "@tiptap/core";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import { BlockId } from "./block-id";
import { getBodyFragment } from "./editor";
import * as outliner from "./outliner";
import { YSync } from "./y-sync";

const editors: Editor[] = [];
const baseExts = [
  StarterKit.configure({ undoRedo: false, heading: { levels: [1, 2, 3] } }),
  TaskList,
  TaskItem.configure({ nested: true }),
  BlockId,
  outliner.Outliner,
];
const makeEditor = (doc?: Y.Doc): Editor => {
  const ed = new Editor({
    extensions: [...baseExts, ...(doc ? [YSync(getBodyFragment(doc))] : [])],
  });
  editors.push(ed);
  return ed;
};

afterEach(() => {
  while (editors.length > 0) editors.pop()?.destroy();
});

describe("Outliner (#25)", () => {
  it("indents and outdents top-level blocks with Tab/Shift+Tab and caps at MAX_OUTLINER_INDENT", () => {
    const ed = makeEditor();
    ed.commands.setContent("<p>Raíz</p><p>Hijo</p>");
    ed.commands.setTextSelection(ed.state.doc.child(0).nodeSize + 1);
    for (let i = 1; i <= outliner.MAX_OUTLINER_INDENT + 2; i++) {
      outliner.shiftTopBlockIndent(ed.state, ed.view.dispatch, 1);
    }
    expect(ed.state.doc.child(1).attrs.indent).toBe(outliner.MAX_OUTLINER_INDENT);
    expect(ed.view.dom.querySelectorAll("p")[1]?.getAttribute("data-indent")).toBe("6");
    outliner.shiftTopBlockIndent(ed.state, ed.view.dispatch, -1);
    expect(ed.state.doc.child(1).attrs.indent).toBe(outliner.MAX_OUTLINER_INDENT - 1);
  });

  it("folds and unfolds outliner indented subtrees and heading sections", () => {
    const ed = makeEditor();
    ed.commands.setContent(
      '<h2>Sección A</h2><p data-indent="1">Detalle 1</p><p data-indent="2">Subdetalle</p><h2>Sección B</h2><p>Visible</p>',
    );
    const q = (sel: string) => ed.view.dom.querySelectorAll(sel);
    expect(q(".fossil-fold-btn").length).toBe(3);
    expect(q(".fossil-block-hidden").length).toBe(0);
    outliner.toggleBlockFoldAtPos(ed.state, ed.view.dispatch, ed.state.doc.child(0).nodeSize);
    expect(ed.state.doc.child(1).attrs.collapsed).toBe(true);
    expect(q(".fossil-block-hidden").length).toBe(1);
    outliner.toggleBlockFoldAtPos(ed.state, ed.view.dispatch, 0);
    expect(q(".fossil-block-hidden").length).toBe(2);
    expect(q("h2")[1]?.classList.contains("fossil-block-hidden")).toBe(false);
  });

  it("cleans pasted HTML with inline styles and wrapper noise while keeping semantic marks", () => {
    const dirty = `<style>body{color:red}</style><template><p>oculto</p></template><form><textarea>x</textarea><select><option>y</option></select><button>z</button></form><input type="text" value="no"><ul data-type="taskList"><li data-checked="true"><input type="CHECKBOX" checked></li></ul><audio><source><track></audio><video></video><math></math><embed><b style="font-weight:normal" id="docs-internal-guid"><p class="MsoNormal" style="font-family:Calibri" data-block-id="x">Texto\u00a0con&nbsp;<span style="font-weight:700;font-style:italic;color:blue">énfasis</span>, <a href="https://example.com" onclick="alert(1)" style="color:green">enlace</a> y <a href="javascript:alert(1)">malo</a></p></b>`;
    const cleaned = outliner.cleanPastedHTML(dirty);
    for (const bad of [
      "style=",
      "class=",
      "data-block-id",
      "onclick",
      "javascript:",
      "&nbsp;",
      "\u00a0",
      "<template",
      "<form",
      "<textarea",
      "<select",
      "<button",
      "<audio",
      "<video",
      "<math",
      "<embed",
      'type="text"',
    ]) {
      expect(cleaned).not.toContain(bad);
    }
    expect(cleaned).toContain("Texto con <strong><em>énfasis</em></strong>");
    expect(cleaned).toContain('<input type="checkbox" checked="">');
    expect(cleaned).toContain('<a href="https://example.com">enlace</a>');
    expect(outliner.cleanPastedText("a\r\nb\u00a0c")).toBe("a\nb c");
  });

  it("clamps indent to [0, MAX_OUTLINER_INDENT] in both parseHTML and renderHTML", () => {
    const ed = makeEditor();
    ed.commands.setContent('<p data-indent="99">Demasiado</p><p data-indent="-4">Negativo</p>');
    expect(ed.state.doc.child(0).attrs.indent).toBe(outliner.MAX_OUTLINER_INDENT);
    expect(ed.state.doc.child(1).attrs.indent).toBe(0);
    const pos = 0;
    const node = ed.state.doc.nodeAt(pos);
    expect(node).not.toBeNull();
    if (node) {
      ed.view.dispatch(ed.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, indent: 42 }));
    }
    const firstP = ed.view.dom.querySelectorAll("p")[0];
    expect(firstP?.getAttribute("data-indent")).toBe(String(outliner.MAX_OUTLINER_INDENT));
    expect(firstP?.getAttribute("style")).toContain(`--indent: ${outliner.MAX_OUTLINER_INDENT}`);
  });

  it("round-trips numeric indent and boolean collapsed across Yjs and reuses decorations on inline edits", () => {
    const docA = new Y.Doc();
    const edA = makeEditor(docA);
    edA.commands.setContent('<h2>Título</h2><p data-indent="2">Subbloque</p><p>Final</p>');
    const firstBtn = edA.view.dom.querySelector(".fossil-fold-btn");
    edA.view.dispatch(edA.state.tr.insertText("!", 7));
    expect(edA.view.dom.querySelector(".fossil-fold-btn")).toBe(firstBtn);
    outliner.toggleBlockFoldAtPos(edA.state, edA.view.dispatch, 0);

    const docB = new Y.Doc();
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
    const edB = makeEditor(docB);
    expect(edB.state.doc.child(0).attrs.collapsed).toBe(true);
    expect(edB.state.doc.child(1).attrs.indent).toBe(2);
    expect(edB.view.dom.querySelectorAll(".fossil-block-hidden").length).toBe(2);
  });
});
