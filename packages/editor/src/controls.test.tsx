import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Editor } from "@tiptap/core";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { countDocumentStats, DRAG_MIME, moveTopBlock } from "./controls";
import { FossilEditor, getBodyFragment } from "./editor";
import {
  defaultEditorMessages,
  EDITOR_MESSAGES_EN,
  EDITOR_MESSAGES_ES_MX,
  type EditorTranslator,
} from "./i18n";
import type { DocTransport } from "./transport";

const emptyTransport = (): DocTransport => ({
  load: async () => new Uint8Array(),
  apply: async () => {},
});

const mountEditor = async (t?: EditorTranslator, doc = new Y.Doc()) => {
  const holder: { instance: Editor | null } = { instance: null };
  const view = render(
    <FossilEditor
      doc={doc}
      transport={emptyTransport()}
      {...(t ? { t } : {})}
      onReady={(instance) => {
        holder.instance = instance;
      }}
    />,
  );
  await waitFor(() => expect(holder.instance).not.toBeNull());
  return { editor: holder.instance as Editor, doc, view };
};

describe("DragHandle & EditorWordCount (#105b)", () => {
  it("includes all EditorMessages keys as own enumerable properties on defaultEditorMessages", () => {
    const keys = Object.keys(defaultEditorMessages);
    expect(keys).toEqual(Object.keys(EDITOR_MESSAGES_ES_MX));
    expect(keys).toEqual(Object.keys(EDITOR_MESSAGES_EN));
    for (const k of [
      "editor.outliner.collapse",
      "editor.outliner.expand",
      "editor.slash.callout",
      "editor.slash.horizontalRule",
      "editor.slash.table",
      "editor.drag.handle",
      "editor.stats.words",
      "editor.stats.characters",
    ]) {
      expect(keys).toContain(k);
    }
  });

  it("ignores external plain-text drops starting with digits and clears draggedBlockIndex on dragend", async () => {
    const { editor, view } = await mountEditor();
    act(() => {
      editor.commands.setContent("<p>Primero</p><p>Segundo</p>");
    });
    const handles = screen.getAllByRole("button", { name: "Arrastrar para reordenar bloque" });
    const targetBlock = editor.view.dom.querySelectorAll("p")[1] as HTMLElement;

    // Start dragging block 0 via handle's ondragstart, then cancel via ondragend
    const handleBtn = handles[0] as HTMLButtonElement;
    handleBtn.ondragstart?.({
      dataTransfer: { setData: () => {} },
    } as unknown as DragEvent);
    handleBtn.ondragend?.({} as unknown as DragEvent);

    const dispatchDrop = (dataTransfer: { types: string[]; getData: (t: string) => string }) =>
      editor.view.someProp("handleDOMEvents", (events) =>
        events.drop?.(editor.view, {
          target: targetBlock,
          dataTransfer,
          preventDefault: () => {},
        } as unknown as DragEvent),
      );

    // Dropping plain text starting with digits must not reorder blocks
    expect(
      dispatchDrop({
        types: ["text/plain"],
        getData: (type: string) => (type === "text/plain" ? "0 manzanas" : ""),
      }),
    ).toBeFalsy();
    expect([0, 1].map((i) => editor.state.doc.child(i).textContent)).toEqual([
      "Primero",
      "Segundo",
    ]);

    // Dropping with DRAG_MIME reorders blocks
    act(() => {
      expect(
        dispatchDrop({
          types: [DRAG_MIME, "text/plain"],
          getData: (type: string) => (type === DRAG_MIME || type === "text/plain" ? "0" : ""),
        }),
      ).toBe(true);
    });
    expect([0, 1].map((i) => editor.state.doc.child(i).textContent)).toEqual([
      "Segundo",
      "Primero",
    ]);
    view.unmount();
  });

  it("reorders top-level blocks via drag handle without losing or duplicating blockId across Yjs", async () => {
    const { editor, doc } = await mountEditor();
    act(() => {
      editor.commands.setContent("<p>Primero</p><p>Segundo</p><p>Tercero</p>");
    });
    const idsBefore = [0, 1, 2].map((i) => editor.state.doc.child(i).attrs.blockId as string);
    expect(new Set(idsBefore).size).toBe(3);

    const handles = screen.getAllByRole("button", { name: "Arrastrar para reordenar bloque" });
    expect(handles).toHaveLength(3);

    // Keyboard reorder on the first block's drag handle (ArrowDown: 0 -> 1)
    act(() => {
      fireEvent.keyDown(handles[0] as HTMLElement, { key: "ArrowDown" });
    });
    expect([0, 1, 2].map((i) => editor.state.doc.child(i).textContent)).toEqual([
      "Segundo",
      "Primero",
      "Tercero",
    ]);
    expect([0, 1, 2].map((i) => editor.state.doc.child(i).attrs.blockId)).toEqual([
      idsBefore[1],
      idsBefore[0],
      idsBefore[2],
    ]);

    // Programmatic moveTopBlock (2 -> 0) and round-trip across Yjs
    act(() => {
      moveTopBlock(editor.state, editor.view.dispatch, 2, 0);
    });
    const expectedIds = [idsBefore[2], idsBefore[1], idsBefore[0]];
    expect([0, 1, 2].map((i) => editor.state.doc.child(i).attrs.blockId)).toEqual(expectedIds);

    const mirrorDoc = new Y.Doc();
    Y.applyUpdate(mirrorDoc, Y.encodeStateAsUpdate(doc));
    const mirrorIds = getBodyFragment(mirrorDoc)
      .toArray()
      .map((el) => (el as Y.XmlElement).getAttribute("blockId"));
    expect(mirrorIds).toEqual(expectedIds);
  });

  it("counts words and characters live and localizes with editor.stats.* in es-MX and en", async () => {
    const { editor, view } = await mountEditor();
    expect(screen.getByText("0 palabras · 0 caracteres")).toBeDefined();

    act(() => {
      editor.commands.setContent("<p>Hola mundo</p><p>Fossil</p>");
    });
    expect(countDocumentStats(editor.state.doc)).toEqual({ words: 3, characters: 16 });
    expect(screen.getByText("3 palabras · 16 caracteres")).toBeDefined();
    view.unmount();

    const { editor: enEditor } = await mountEditor((k) => EDITOR_MESSAGES_EN[k]);
    act(() => {
      enEditor.commands.setContent("<p>One two</p>");
    });
    expect(screen.getByText("2 words · 7 characters")).toBeDefined();
  });

  it("maps DragHandle decorations and keeps keystroke latency low on a 5 000-block document (#50)", async () => {
    const doc = new Y.Doc();
    const fragment = getBodyFragment(doc);
    doc.transact(() => {
      const ps: Y.XmlElement[] = [];
      for (let i = 0; i < 5000; i++) {
        const p = new Y.XmlElement("paragraph");
        p.setAttribute("blockId", `blk_${i}`);
        const txt = new Y.XmlText();
        txt.insert(0, `Bloque número ${i} con texto de prueba`);
        p.insert(0, [txt]);
        ps.push(p);
      }
      fragment.insert(0, ps);
    });

    const { editor, view } = await mountEditor(undefined, doc);
    expect(editor.state.doc.childCount).toBe(5000);

    const firstHandleBefore = editor.view.dom.querySelector(".fossil-drag-handle");
    expect(firstHandleBefore).not.toBeNull();

    // Measure countDocumentStats directly on 5,000 blocks
    const statsStart = performance.now();
    const stats = countDocumentStats(editor.state.doc);
    const statsMs = performance.now() - statsStart;
    expect(stats.words).toBe(35000);

    // Measure 5 keystrokes (insertText("a")) on full <FossilEditor> with 5,000 blocks
    const keys = 5;
    const keyStart = performance.now();
    act(() => {
      for (let k = 0; k < keys; k++) {
        editor.view.dispatch(editor.state.tr.insertText("a", 2 + k));
      }
    });
    const perKeyMs = (performance.now() - keyStart) / keys;

    // Measure cursor-only transaction (EditorWordCount must not recompute on selection change)
    const selStart = performance.now();
    act(() => {
      editor.commands.setTextSelection(4);
    });
    const selMs = performance.now() - selStart;

    expect(editor.view.dom.querySelector(".fossil-drag-handle")).toBe(firstHandleBefore);
    expect(perKeyMs).toBeLessThan(200);
    expect(statsMs).toBeLessThan(35);
    expect(selMs).toBeLessThan(35);
    view.unmount();
  }, 60000);
});
