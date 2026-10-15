import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Editor } from "@tiptap/core";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { countDocumentStats, moveTopBlock } from "./controls";
import { FossilEditor, getBodyFragment } from "./editor";
import { EDITOR_MESSAGES_EN, type EditorTranslator } from "./i18n";
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
      for (let i = 0; i < 5000; i++) {
        const p = new Y.XmlElement("paragraph");
        p.setAttribute("blockId", `blk_${i}`);
        const txt = new Y.XmlText();
        txt.insert(0, `Bloque número ${i} con texto de prueba`);
        p.insert(0, [txt]);
        fragment.insert(fragment.length, [p]);
      }
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
  }, 30000);
});
