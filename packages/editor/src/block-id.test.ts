import { Editor } from "@tiptap/core";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import StarterKit from "@tiptap/starter-kit";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { BlockId } from "./block-id";
import { getBodyFragment } from "./editor";
import { YSync } from "./y-sync";

const createEditor = (doc?: Y.Doc): Editor => {
  const extensions = [
    StarterKit.configure({ undoRedo: false, heading: { levels: [1, 2, 3] } }),
    TaskList,
    TaskItem.configure({ nested: true }),
    BlockId,
    ...(doc ? [YSync(getBodyFragment(doc))] : []),
  ];
  return new Editor({ element: document.createElement("div"), extensions });
};

const topLevelIds = (editor: Editor): string[] => {
  const ids: string[] = [];
  editor.state.doc.forEach((node) => {
    if (typeof node.attrs.blockId === "string") ids.push(node.attrs.blockId);
  });
  return ids;
};

describe("BlockId", () => {
  it("assigns a blockId to the initial document on creation and renders data-block-id", async () => {
    const editor = createEditor();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const ids = topLevelIds(editor);
    expect(ids).toHaveLength(1);
    expect(ids[0]).toMatch(/^[0-9a-f-]{36}$/i);
    const paragraphEl = editor.view.dom.querySelector("[data-block-id]");
    expect(paragraphEl?.getAttribute("data-block-id")).toBe(ids[0]);
    editor.destroy();
  });

  it("preserves the first blockId on split and assigns a fresh UUID to the duplicated second block", () => {
    const editor = createEditor();
    editor.commands.insertContent("AlphaBeta");
    const originalId = topLevelIds(editor)[0];
    expect(originalId).toBeDefined();

    editor.commands.setTextSelection(6);
    editor.commands.splitBlock();

    const idsAfterSplit = topLevelIds(editor);
    expect(idsAfterSplit).toHaveLength(2);
    expect(idsAfterSplit[0]).toBe(originalId);
    expect(idsAfterSplit[1]).toMatch(/^[0-9a-f-]{36}$/i);
    expect(idsAfterSplit[1]).not.toBe(originalId);
    editor.destroy();
  });

  it("round-trips top-level blockIds in order, numeric heading level, and boolean task checked across Yjs", async () => {
    const sourceDoc = new Y.Doc();
    const sourceEditor = createEditor(sourceDoc);
    sourceEditor.commands.setContent({
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 2 },
          content: [{ type: "text", text: "Section title" }],
        },
        {
          type: "taskList",
          content: [
            {
              type: "taskItem",
              attrs: { checked: true },
              content: [{ type: "paragraph", content: [{ type: "text", text: "Done item" }] }],
            },
            {
              type: "taskItem",
              attrs: { checked: false },
              content: [{ type: "paragraph", content: [{ type: "text", text: "Pending item" }] }],
            },
          ],
        },
        { type: "paragraph", content: [{ type: "text", text: "Body paragraph" }] },
      ],
    });

    const expectedIds = topLevelIds(sourceEditor);
    expect(expectedIds).toHaveLength(3);
    expect(new Set(expectedIds).size).toBe(3);

    const targetDoc = new Y.Doc();
    Y.applyUpdate(targetDoc, Y.encodeStateAsUpdate(sourceDoc));

    const targetEditor = createEditor(targetDoc);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(topLevelIds(targetEditor)).toEqual(expectedIds);

    const firstNode = targetEditor.state.doc.child(0);
    expect(firstNode.type.name).toBe("heading");
    expect(firstNode.attrs.level).toBe(2);
    expect(typeof firstNode.attrs.level).toBe("number");

    const secondNode = targetEditor.state.doc.child(1);
    expect(secondNode.type.name).toBe("taskList");
    const firstTask = secondNode.child(0);
    const secondTask = secondNode.child(1);
    expect(firstTask.attrs.checked).toBe(true);
    expect(typeof firstTask.attrs.checked).toBe("boolean");
    expect(secondTask.attrs.checked).toBe(false);
    expect(typeof secondTask.attrs.checked).toBe("boolean");

    sourceEditor.destroy();
    targetEditor.destroy();
  });
});
