import { fireEvent } from "@testing-library/dom";
import { Editor } from "@tiptap/core";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import StarterKit from "@tiptap/starter-kit";
import { describe, expect, it } from "vitest";
import { redo, undo, yUndoPluginKey } from "y-prosemirror";
import * as Y from "yjs";
import { BlockId } from "./block-id";
import { Callout, TABLE_EXTENSIONS } from "./blocks";
import { DragHandle, moveCurrentTopBlock } from "./controls";
import { Outliner } from "./outliner";
import { YSync } from "./y-sync";

/**
 * Regression suite for issue #77 (r1-editor-heavy): heavy editing must never lose
 * content nor mutate or duplicate top-level block IDs (ADR-0005, ADR-0015).
 *
 * Convention with the implementing lane: a test that expresses desired behavior
 * which still fails today is written with `it.fails` — Vitest runs it and asserts
 * the failure, so once the product fix lands the suite goes red until the `.fails`
 * marker is dropped and it becomes a plain `it`. Each of those tests carries a
 * comment stating the observed cause. Tests that document current, correct
 * behavior stay as plain `it`.
 */

/** Same extension stack as `<FossilEditor />` minus the React-only widgets. */
const createHeavyEditor = (doc: Y.Doc = new Y.Doc()): { editor: Editor; doc: Y.Doc } => {
  const editor = new Editor({
    element: document.createElement("div"),
    extensions: [
      StarterKit.configure({ undoRedo: false, heading: { levels: [1, 2, 3] } }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Callout,
      ...TABLE_EXTENSIONS,
      BlockId,
      Outliner,
      DragHandle,
      YSync(doc.getXmlFragment("body")),
    ],
  });
  return { editor, doc };
};

const topLevelIds = (editor: Editor): string[] => {
  const ids: string[] = [];
  editor.state.doc.forEach((node) => {
    if (typeof node.attrs.blockId === "string") ids.push(node.attrs.blockId);
  });
  return ids;
};

const textsOf = (editor: Editor): string[] => {
  const texts: string[] = [];
  editor.state.doc.forEach((node) => {
    texts.push(node.textContent);
  });
  return texts;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Asserts every top-level block has a unique, well-formed ID and returns them. */
const expectUniqueIds = (editor: Editor): string[] => {
  const ids = topLevelIds(editor);
  for (const id of ids) expect(id).toMatch(UUID_RE);
  expect(new Set(ids).size).toBe(ids.length);
  return ids;
};

/** Position `offset` characters inside the text of top-level block `index`. */
const posInsideBlock = (editor: Editor, index: number, offset = 0): number => {
  let pos = 0;
  for (let i = 0; i < index; i++) pos += editor.state.doc.child(i).nodeSize;
  return pos + 1 + offset;
};

/** Position right after the last character of top-level block `index`. */
const posAtEndOfBlock = (editor: Editor, index: number): number =>
  posInsideBlock(editor, index, editor.state.doc.child(index).textContent.length);

/** Selection boundaries spanning top-level blocks `first` through `last` (inclusive). */
const selectionAcrossBlocks = (editor: Editor, first: number, last: number) => {
  let start = 0;
  for (let i = 0; i < first; i++) start += editor.state.doc.child(i).nodeSize;
  let end = start;
  for (let i = first; i <= last; i++) end += editor.state.doc.child(i).nodeSize;
  return { from: start + 1, to: end - 1 };
};

interface ClipboardMock {
  getData(type: string): string;
  setData(type: string, value: string): void;
  clearData(): void;
  html: () => string;
}

const clipboardMock = (): ClipboardMock => {
  const data = new Map<string, string>();
  return {
    getData: (type) => data.get(type) ?? "",
    setData: (type, value) => void data.set(type, value),
    clearData: () => void data.clear(),
    html: () => data.get("text/html") ?? "",
  };
};

const fireClipboardEvent = (
  editor: Editor,
  kind: "copy" | "cut" | "paste",
  clipboard: ClipboardMock,
): void => {
  const event = new Event(kind, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", { value: clipboard });
  editor.view.dom.dispatchEvent(event);
};

const pasteHTML = (editor: Editor, html: string): void => {
  fireClipboardEvent(editor, "paste", {
    ...clipboardMock(),
    getData: (type: string) => (type === "text/html" ? html : ""),
  });
};

/** Closes the current Y.UndoManager capture window, like a pause between user actions. */
const separateUndoStep = (editor: Editor): void => {
  yUndoPluginKey.getState(editor.state)?.undoManager.stopCapturing();
};

const expectUndo = (editor: Editor): void => {
  expect(undo(editor.state)).toBe(true);
};
const expectRedo = (editor: Editor): void => {
  expect(redo(editor.state)).toBe(true);
};

/** Neutral five-block body: a branch ("Rama Acme" + two children) between two blocks. */
const BRANCH_HTML =
  "<p>Antes de la rama</p><p>Rama Acme</p>" +
  '<p data-indent="1">Hijo uno</p><p data-indent="1">Hijo dos</p><p>Después de la rama</p>';

describe("Undo/redo (#77)", () => {
  // FAILS (2026-10-15): `undo()` returns false — the paste never reaches the Yjs
  // UndoManager. y-prosemirror replicates a dispatch based on the LAST inner
  // transaction's `addToHistory` meta; pasting new blocks makes `BlockId`
  // append a reassignment transaction that sets `addToHistory: false`, so the
  // whole action (paste included) bypasses the UndoManager and Ctrl+Z does nothing.
  it.fails("undoes and redoes a multi-block paste keeping block IDs stable", () => {
    const { editor } = createHeavyEditor();
    editor.commands.setContent("<p>Uno</p><p>Dos</p><p></p>");
    const baseIds = expectUniqueIds(editor);
    separateUndoStep(editor);
    editor.commands.setTextSelection(posAtEndOfBlock(editor, 2));
    pasteHTML(editor, "<p>Pegado Acme uno</p><p>Pegado Acme dos</p>");
    expect(textsOf(editor).slice(0, 2)).toEqual(["Uno", "Dos"]);
    const pastedText = textsOf(editor).join("|");
    expect(pastedText).toContain("Pegado Acme uno");
    expect(pastedText).toContain("Pegado Acme dos");
    const pastedIds = topLevelIds(editor).slice(2);

    expectUndo(editor);
    expect(textsOf(editor)).toEqual(["Uno", "Dos", ""]);
    expect(topLevelIds(editor)).toEqual(baseIds);

    expectRedo(editor);
    expect(textsOf(editor).join("|")).toContain("Pegado Acme uno");
    expect(textsOf(editor).join("|")).toContain("Pegado Acme dos");
    expect(topLevelIds(editor).slice(2)).toEqual(pastedIds);
    editor.destroy();
  });

  // FAILS (2026-10-15): same root cause as the paste case above — splitting a
  // paragraph makes `BlockId` append an `addToHistory: false` reassignment
  // transaction for the new block's fresh ID, so `undo()` returns false and the
  // split cannot be reverted (Ctrl+Z after Enter does nothing today).
  it.fails("undoes and redoes a paragraph split, keeping the original ID and replaying the split ID", () => {
    const { editor } = createHeavyEditor();
    editor.commands.setContent("<p>AlphaBeta</p>");
    const [originalId] = expectUniqueIds(editor);
    separateUndoStep(editor);
    editor.commands.setTextSelection(posInsideBlock(editor, 0, 5));
    editor.commands.splitBlock();
    const afterSplitIds = topLevelIds(editor);
    expect(afterSplitIds).toEqual([originalId, afterSplitIds[1]]);
    expect(textsOf(editor)).toEqual(["Alpha", "Beta"]);

    expectUndo(editor);
    expect(textsOf(editor)).toEqual(["AlphaBeta"]);
    expect(topLevelIds(editor)).toEqual([originalId]);

    expectRedo(editor);
    expect(textsOf(editor)).toEqual(["Alpha", "Beta"]);
    expect(topLevelIds(editor)).toEqual(afterSplitIds);
    editor.destroy();
  });

  it("undoes and redoes moving a block, keeping order and IDs", () => {
    const { editor } = createHeavyEditor();
    editor.commands.setContent(BRANCH_HTML);
    const ids = expectUniqueIds(editor);
    separateUndoStep(editor);
    editor.commands.setTextSelection(posInsideBlock(editor, 1));
    expect(moveCurrentTopBlock(editor.state, editor.view.dispatch, 1)).toBe(true);
    expect(textsOf(editor)).toEqual([
      "Antes de la rama",
      "Hijo uno",
      "Rama Acme",
      "Hijo dos",
      "Después de la rama",
    ]);
    expect(topLevelIds(editor)).toEqual([ids[0], ids[2], ids[1], ids[3], ids[4]]);

    expectUndo(editor);
    expect(topLevelIds(editor)).toEqual(ids);

    expectRedo(editor);
    expect(topLevelIds(editor)).toEqual([ids[0], ids[2], ids[1], ids[3], ids[4]]);
    editor.destroy();
  });

  // FAILS (2026-10-15): `moveCurrentTopBlock` (Alt+ArrowUp/Down, and the drag handle's
  // arrow keys — both funnel through `moveTopBlock`) relocates only the one top-level
  // block under the cursor; its indented children stay behind. Moving a branch must
  // carry the children along, preserving relative order and IDs.
  it.fails("moving a complete branch by keyboard carries its indented children along", () => {
    const { editor } = createHeavyEditor();
    editor.commands.setContent(BRANCH_HTML);
    const ids = expectUniqueIds(editor);
    editor.commands.setTextSelection(posInsideBlock(editor, 1));
    expect(moveCurrentTopBlock(editor.state, editor.view.dispatch, 1)).toBe(true);
    expect(textsOf(editor)).toEqual([
      "Antes de la rama",
      "Después de la rama",
      "Rama Acme",
      "Hijo uno",
      "Hijo dos",
    ]);
    expect(topLevelIds(editor)).toEqual([ids[0], ids[4], ids[1], ids[2], ids[3]]);
    editor.destroy();
  });

  it("undoes and redoes indenting (Tab) a top-level block", () => {
    const { editor } = createHeavyEditor();
    editor.commands.setContent("<p>Acme</p>");
    separateUndoStep(editor);
    fireEvent.keyDown(editor.view.dom, { key: "Tab" });
    expect(editor.state.doc.child(0).attrs.indent).toBe(1);

    expectUndo(editor);
    expect(editor.state.doc.child(0).attrs.indent).toBe(0);

    expectRedo(editor);
    expect(editor.state.doc.child(0).attrs.indent).toBe(1);
    editor.destroy();
  });
});

describe("Cut & paste of a whole branch (#77)", () => {
  // FAILS (2026-10-15): the Outliner's `transformPastedHTML` (`cleanPastedHTML`) strips
  // every attribute outside its allowlist, including `data-block-id`, so the pasted
  // branch loses its original IDs and `BlockId` mints fresh ones: a cut & paste (move)
  // rewrites all IDs of the moved branch. Content and order survive (the text
  // assertions below pass); only the ID assertion fails.
  it.fails("cutting and pasting a complete branch preserves its block IDs", () => {
    const { editor } = createHeavyEditor();
    editor.commands.setContent(BRANCH_HTML);
    const ids = expectUniqueIds(editor);
    editor.commands.setTextSelection(selectionAcrossBlocks(editor, 1, 3));
    const clipboard = clipboardMock();
    fireClipboardEvent(editor, "cut", clipboard);
    expect(textsOf(editor)).toEqual(["Antes de la rama", "", "Después de la rama"]);

    // Paste the branch back into the emptied spot.
    editor.commands.setTextSelection(posAtEndOfBlock(editor, 1));
    fireClipboardEvent(editor, "paste", clipboard);
    expect(textsOf(editor)).toEqual([
      "Antes de la rama",
      "Rama Acme",
      "Hijo uno",
      "Hijo dos",
      "Después de la rama",
    ]);
    expect(topLevelIds(editor)).toEqual(ids);
    editor.destroy();
  });
});
