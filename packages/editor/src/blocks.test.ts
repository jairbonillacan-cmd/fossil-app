import { Editor } from "@tiptap/core";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import { BlockId } from "./block-id";
import { Callout, moveTableCell, TABLE_EXTENSIONS } from "./blocks";
import { getBodyFragment } from "./editor";
import { Outliner } from "./outliner";
import { SLASH_COMMAND_ITEMS } from "./slash-menu";
import { YSync } from "./y-sync";

const editors: Editor[] = [];
const makeEditor = (doc?: Y.Doc): Editor => {
  const ed = new Editor({
    extensions: [
      StarterKit.configure({ undoRedo: false, heading: { levels: [1, 2, 3] } }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Callout,
      ...TABLE_EXTENSIONS,
      BlockId,
      Outliner,
      ...(doc ? [YSync(getBodyFragment(doc))] : []),
    ],
  });
  editors.push(ed);
  return ed;
};

afterEach(() => {
  while (editors.length > 0) editors.pop()?.destroy();
});

describe("Callout, horizontalRule & Table blocks (#105a)", () => {
  it("executes slash commands for callout, horizontalRule, and table", () => {
    for (const id of ["callout", "horizontalRule", "table"] as const) {
      const ed = makeEditor();
      ed.commands.setContent("<p>/cmd</p>");
      SLASH_COMMAND_ITEMS.find((it) => it.id === id)?.run(ed, { from: 1, to: 5 });
      expect(ed.state.doc.firstChild?.type.name).toBe(id);
    }
  });

  it("navigates table cells with Tab/Shift-Tab and appends a row on Tab at the last cell", () => {
    const ed = makeEditor();
    ed.commands.insertTable({ rows: 2, cols: 2 });
    for (const label of ["Col A", "Col B", "Val 1", "Val 2"]) {
      ed.commands.insertContent(label);
      moveTableCell(ed.state, ed.view.dispatch, 1);
    }
    ed.commands.insertContent("Val 3");
    const table = ed.state.doc.firstChild;
    expect(table?.type.name).toBe("table");
    expect(table?.childCount).toBe(3);
    expect(table?.child(0).child(0).textContent).toBe("Col A");
    expect(table?.child(0).child(1).textContent).toBe("Col B");
    expect(table?.child(1).child(1).textContent).toBe("Val 2");
    expect(table?.child(2).child(0).textContent).toBe("Val 3");
  });

  it("round-trips callout, horizontalRule, and table with blockIds across Yjs", () => {
    const docA = new Y.Doc();
    const edA = makeEditor(docA);
    edA.commands.setContent(
      '<p>Inicio</p><aside data-type="callout"><p>Aviso importante</p></aside><hr><table><tr><th><p>Métrica</p></th><th><p>Valor</p></th></tr><tr><td><p>Latencia</p></td><td><p>12 ms</p></td></tr></table>',
    );
    const idsA = [0, 1, 2, 3].map((i) => edA.state.doc.child(i).attrs.blockId);
    expect(idsA.every((id) => typeof id === "string" && id.length > 0)).toBe(true);
    expect(new Set(idsA).size).toBe(4);

    const docB = new Y.Doc();
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
    const edB = makeEditor(docB);

    expect([0, 1, 2, 3].map((i) => edB.state.doc.child(i).type.name)).toEqual([
      "paragraph",
      "callout",
      "horizontalRule",
      "table",
    ]);
    expect([0, 1, 2, 3].map((i) => edB.state.doc.child(i).attrs.blockId)).toEqual(idsA);
    expect(edB.state.doc.child(1).textContent).toBe("Aviso importante");
    expect(edB.state.doc.child(3).child(0).child(0).textContent).toBe("Métrica");
    expect(edB.state.doc.child(3).child(1).child(1).textContent).toBe("12 ms");
  });
});
