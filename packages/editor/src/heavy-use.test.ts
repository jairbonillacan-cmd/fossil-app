import { Editor } from "@tiptap/core";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { TextSelection } from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";
import { describe, expect, it } from "vitest";
import { redo, undo, yUndoPluginKey } from "y-prosemirror";
import * as Y from "yjs";
import { BlockId } from "./block-id";
import { DragHandle, moveCurrentTopBlock, moveTopBranch } from "./controls";
import { getBodyFragment } from "./editor";
import { Outliner } from "./outliner";
import { YSync } from "./y-sync";

const UUID = /^[0-9a-f-]{36}$/i;

function createEditor(doc: Y.Doc): Editor {
  return new Editor({
    element: document.createElement("div"),
    extensions: [
      StarterKit.configure({ undoRedo: false, heading: { levels: [1, 2, 3] } }),
      TaskList,
      TaskItem.configure({ nested: true }),
      BlockId,
      Outliner,
      DragHandle,
      YSync(getBodyFragment(doc)),
    ],
  });
}

/** Seeds `n` paragraphs `P0..P(n-1)` with indent given by `indents[i]` (default 0). */
function seed(editor: Editor, n: number, indents: number[] = []): void {
  editor.commands.setContent({
    type: "doc",
    content: Array.from({ length: n }, (_, i) => ({
      type: "paragraph",
      attrs: { indent: indents[i] ?? 0 },
      content: [{ type: "text", text: `P${i}` }],
    })),
  });
  closeUndoGroup(editor);
}

/** Ends the current undo capture group so the next change is its own step. */
function closeUndoGroup(editor: Editor): void {
  yUndoPluginKey.getState(editor.state)?.undoManager.stopCapturing();
}

const blocks = (editor: Editor) => {
  const out: { id: string; text: string; indent: number }[] = [];
  editor.state.doc.forEach((node) => {
    out.push({
      id: String(node.attrs.blockId),
      text: node.textContent,
      indent: Number(node.attrs.indent ?? 0),
    });
  });
  return out;
};
const ids = (editor: Editor) => blocks(editor).map((b) => b.id);
const texts = (editor: Editor) => blocks(editor).map((b) => b.text);

function selectBlocks(editor: Editor, from: number, to: number): void {
  let start = 0;
  let end = 0;
  let pos = 0;
  editor.state.doc.forEach((node, _o, i) => {
    if (i === from) start = pos + 1;
    if (i === to) end = pos + node.nodeSize - 1;
    pos += node.nodeSize;
  });
  editor.view.dispatch(
    editor.state.tr.setSelection(TextSelection.create(editor.state.doc, start, end)),
  );
}

/** Dispatches a paste through ProseMirror's own handler (jsdom has no ClipboardEvent). */
function pasteHtml(editor: Editor, html: string): void {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  const data: Record<string, string> = { "text/html": html, "text/plain": "" };
  Object.defineProperty(event, "clipboardData", {
    value: {
      types: Object.keys(data),
      getData: (type: string) => data[type] ?? "",
      files: [],
      items: [],
    },
  });
  editor.view.dom.dispatchEvent(event);
}

function cursorInBlock(editor: Editor, index: number): void {
  let pos = 0;
  editor.state.doc.forEach((node, _o, i) => {
    if (i < index) pos += node.nodeSize;
  });
  editor.commands.setTextSelection(pos + 1);
}

describe("heavy use: undo/redo", () => {
  it("undoes and redoes typing without changing block IDs", () => {
    const editor = createEditor(new Y.Doc());
    seed(editor, 3);
    const before = ids(editor);
    cursorInBlock(editor, 1);
    editor.commands.insertContent("xyz");
    expect(texts(editor)[1]).toBe("xyzP1");
    closeUndoGroup(editor);
    undo(editor.state);
    expect(texts(editor)).toEqual(["P0", "P1", "P2"]);
    expect(ids(editor)).toEqual(before);
    redo(editor.state);
    expect(texts(editor)[1]).toBe("xyzP1");
    expect(ids(editor)).toEqual(before);
    editor.destroy();
  });

  it("keeps every block ID through type, move, paste and undo/redo in 5 000 blocks", async () => {
    const doc = new Y.Doc();
    const frag = getBodyFragment(doc);
    doc.transact(() => {
      const els: Y.XmlElement[] = [];
      for (let i = 0; i < 5000; i++) {
        const p = new Y.XmlElement("paragraph");
        p.setAttribute("blockId", crypto.randomUUID());
        const text = new Y.XmlText();
        text.insert(0, `Block ${i}`);
        p.insert(0, [text]);
        els.push(p);
      }
      frag.insert(0, els);
    });
    const editor = createEditor(doc);
    await new Promise((resolve) => setTimeout(resolve, 50));
    const original = ids(editor);
    expect(original).toHaveLength(5000);

    cursorInBlock(editor, 2500);
    editor.commands.insertContent("typed ");
    closeUndoGroup(editor);
    moveCurrentTopBlock(editor.state, editor.view.dispatch, 1);
    closeUndoGroup(editor);
    pasteHtml(editor, "<p>pasted one</p><p>pasted two</p>");
    closeUndoGroup(editor);
    expect(editor.state.doc.childCount).toBeGreaterThan(5000);

    for (let i = 0; i < 3; i++) {
      undo(editor.state);
      closeUndoGroup(editor);
    }
    expect(ids(editor)).toEqual(original);
    expect(texts(editor)[2500]).toBe("Block 2500");
    for (let i = 0; i < 3; i++) {
      redo(editor.state);
      closeUndoGroup(editor);
    }
    expect(editor.state.doc.childCount).toBeGreaterThan(5000);
    const all = ids(editor);
    expect(new Set(all).size).toBe(all.length);
    editor.destroy();
  }, 60000);
});

describe("heavy use: multi-block selection", () => {
  it("deletes a selected range leaving no orphans and keeping surviving IDs", () => {
    const editor = createEditor(new Y.Doc());
    seed(editor, 5);
    const before = ids(editor);
    selectBlocks(editor, 1, 3);
    editor.commands.deleteSelection();
    // The range joins P1's start with P3's end; P4 survives untouched.
    expect(texts(editor)).toEqual(["P0", "", "P4"]);
    expect(ids(editor)[0]).toBe(before[0]);
    expect(ids(editor)[2]).toBe(before[4]);
    expect(new Set(ids(editor)).size).toBe(ids(editor).length);
    editor.destroy();
  });

  it("cut then paste elsewhere yields unique IDs and the same text order", () => {
    const editor = createEditor(new Y.Doc());
    seed(editor, 5);
    selectBlocks(editor, 1, 2);
    const slice = editor.state.selection.content();
    editor.commands.deleteSelection();
    cursorInBlock(editor, editor.state.doc.childCount - 1);
    editor.view.dispatch(editor.state.tr.replaceSelection(slice));
    const all = ids(editor);
    expect(new Set(all).size).toBe(all.length);
    all.forEach((id) => {
      expect(id).toMatch(UUID);
    });
    expect(texts(editor).join("|")).toContain("P1");
    expect(texts(editor).join("|")).toContain("P2");
    editor.destroy();
  });

  it("copy then paste duplicates content but never duplicates IDs", () => {
    const editor = createEditor(new Y.Doc());
    seed(editor, 3);
    selectBlocks(editor, 0, 1);
    const slice = editor.state.selection.content();
    cursorInBlock(editor, 2);
    editor.view.dispatch(editor.state.tr.replaceSelection(slice));
    const all = ids(editor);
    expect(new Set(all).size).toBe(all.length);
    editor.destroy();
  });
});

describe("heavy use: moving a branch", () => {
  // P0 (root) → P1, P2 (children, indent 1) → P3 (root) → P4 (child)
  const indents = [0, 1, 1, 0, 1];

  it("moves a block together with its indented children, preserving IDs and order", () => {
    const editor = createEditor(new Y.Doc());
    seed(editor, 5, indents);
    const before = new Map(blocks(editor).map((b) => [b.text, b.id]));
    cursorInBlock(editor, 0);
    editor.commands.focus();
    editor.view.dom.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", altKey: true, bubbles: true }),
    );
    expect(texts(editor)).toEqual(["P3", "P4", "P0", "P1", "P2"]);
    for (const b of blocks(editor)) expect(b.id).toBe(before.get(b.text));
    editor.destroy();
  });

  it("moves a branch up past the previous branch", () => {
    const editor = createEditor(new Y.Doc());
    seed(editor, 5, indents);
    const before = new Map(blocks(editor).map((b) => [b.text, b.id]));
    cursorInBlock(editor, 3);
    editor.commands.focus();
    editor.view.dom.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowUp", altKey: true, bubbles: true }),
    );
    expect(texts(editor)).toEqual(["P3", "P4", "P0", "P1", "P2"]);
    for (const b of blocks(editor)) expect(b.id).toBe(before.get(b.text));
    editor.destroy();
  });

  it("rejects drops inside the branch or out of bounds, and moves to arbitrary index", () => {
    const editor = createEditor(new Y.Doc());
    seed(editor, 5, indents);
    const before = ids(editor);
    // Dropping inside the branch (P0's branch spans 0..2) returns false without mutating doc
    expect(moveTopBranch(editor.state, editor.view.dispatch, 0, 1)).toBe(false);
    expect(moveTopBranch(editor.state, editor.view.dispatch, 0, 2)).toBe(false);
    // Out of bounds returns false
    expect(moveTopBranch(editor.state, editor.view.dispatch, -1, 3)).toBe(false);
    expect(moveTopBranch(editor.state, editor.view.dispatch, 0, 10)).toBe(false);
    expect(ids(editor)).toEqual(before);

    // Moving P0's branch directly to the last block (4) carries children to the end
    expect(moveTopBranch(editor.state, editor.view.dispatch, 0, 4)).toBe(true);
    expect(texts(editor)).toEqual(["P3", "P4", "P0", "P1", "P2"]);
    editor.destroy();
  });

  it("moves a branch via the drag handle arrow keys", () => {
    const editor = createEditor(new Y.Doc());
    seed(editor, 5, indents);
    const before = new Map(blocks(editor).map((b) => [b.text, b.id]));
    const handle = editor.view.dom.querySelector<HTMLButtonElement>(
      '.fossil-drag-handle[data-block-index="0"]',
    );
    expect(handle).not.toBeNull();
    handle?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    expect(texts(editor)).toEqual(["P3", "P4", "P0", "P1", "P2"]);
    for (const b of blocks(editor)) expect(b.id).toBe(before.get(b.text));
    editor.destroy();
  });
});

describe("heavy use: pasting HTML", () => {
  it("does not alter existing IDs when pasting browser HTML mid-document", () => {
    const editor = createEditor(new Y.Doc());
    seed(editor, 3);
    const before = ids(editor);
    cursorInBlock(editor, 1);
    pasteHtml(editor, '<meta charset="utf-8"><p style="color:red" class="x">One</p><p>Two</p>');
    const after = ids(editor);
    for (const id of before) expect(after).toContain(id);
    expect(new Set(after).size).toBe(after.length);
    editor.destroy();
  });

  it("ignores data-block-id carried by pasted HTML (no duplicate IDs)", () => {
    const editor = createEditor(new Y.Doc());
    seed(editor, 2);
    const before = ids(editor);
    cursorInBlock(editor, 1);
    pasteHtml(editor, `<p data-block-id="${before[0]}">Clone</p><p>Other</p>`);
    const after = ids(editor);
    expect(new Set(after).size).toBe(after.length);
    expect(after.filter((id) => id === before[0])).toHaveLength(1);
    editor.destroy();
  });

  it("pastes word-processor and spreadsheet HTML as clean blocks", () => {
    const editor = createEditor(new Y.Doc());
    seed(editor, 1);
    cursorInBlock(editor, 0);
    pasteHtml(
      editor,
      '<p class="MsoNormal" style="mso-x:1"><span style="font-weight:700">Bold</span> text</p>' +
        '<table><tr><td style="x">a</td><td>b</td></tr></table>',
    );
    const html = editor.getHTML();
    expect(html).not.toContain("MsoNormal");
    expect(html).not.toContain("mso-");
    expect(html).toContain("<strong>Bold</strong>");
    const all = ids(editor);
    expect(new Set(all).size).toBe(all.length);
    editor.destroy();
  });
});
