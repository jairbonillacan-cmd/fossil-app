import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Editor } from "@tiptap/core";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { FossilEditor } from "./editor";
import { EDITOR_MESSAGES_EN, type EditorTranslator } from "./i18n";
import { placeSlashMenu } from "./slash-menu";
import type { DocTransport } from "./transport";

const emptyTransport = (): DocTransport => ({
  load: async () => new Uint8Array(),
  apply: async () => {},
});

const mountEditor = async (t?: EditorTranslator) => {
  const holder: { instance: Editor | null } = { instance: null };
  const view = render(
    <FossilEditor
      doc={new Y.Doc()}
      transport={emptyTransport()}
      {...(t ? { t } : {})}
      onReady={(instance) => {
        holder.instance = instance;
      }}
    />,
  );
  await waitFor(() => expect(holder.instance).not.toBeNull());
  return { editor: holder.instance as Editor, view };
};

/** Simulates live character-by-character typing through ProseMirror's `handleTextInput` prop. */
const typeLiveText = (editor: Editor, text: string): void => {
  for (const ch of text) {
    const { from, to } = editor.state.selection;
    const deflt = () => editor.state.tr.insertText(ch, from, to);
    const handled = editor.view.someProp("handleTextInput", (f) =>
      f(editor.view, from, to, ch, deflt),
    );
    if (!handled) editor.view.dispatch(deflt());
  }
};

describe("SlashMenu and live Markdown shortcuts", () => {
  it("opens on '/', translates via props.t, filters, and executes on Enter", async () => {
    const { editor } = await mountEditor((key) => EDITOR_MESSAGES_EN[key]);
    act(() => typeLiveText(editor, "/h2"));
    expect(await screen.findByRole("listbox", { name: "Block commands" })).toBeDefined();
    expect(screen.getByRole("option", { name: /Heading 2/ }).getAttribute("aria-selected")).toBe(
      "true",
    );
    act(() => {
      fireEvent.keyDown(editor.view.dom, { key: "Enter" });
    });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(editor.state.doc.firstChild?.type.name).toBe("heading");
    expect(editor.state.doc.firstChild?.attrs.level).toBe(2);
    expect(editor.state.doc.firstChild?.textContent).toBe("");
  });

  it("navigates slash items with ArrowDown and closes on Escape", async () => {
    const { editor } = await mountEditor();
    act(() => typeLiveText(editor, "/"));
    expect(await screen.findByRole("listbox", { name: "Comandos de bloque" })).toBeDefined();
    expect(screen.getAllByRole("option")[0]?.getAttribute("aria-selected")).toBe("true");
    act(() => {
      fireEvent.keyDown(editor.view.dom, { key: "ArrowDown" });
    });
    expect(screen.getAllByRole("option")[1]?.getAttribute("aria-selected")).toBe("true");
    act(() => {
      fireEvent.keyDown(editor.view.dom, { key: "Escape" });
    });
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it.each([
    ["# ", "heading", { level: 1 }],
    ["## ", "heading", { level: 2 }],
    ["### ", "heading", { level: 3 }],
    ["- ", "bulletList", {}],
    ["1. ", "orderedList", {}],
    ["[] ", "taskList", {}],
    ["> ", "blockquote", {}],
    ["``` ", "codeBlock", {}],
    ["---", "horizontalRule", {}],
    ["> ! ", "callout", {}],
    [">! ", "callout", {}],
    [":::callout ", "callout", {}],
    ["| col | ", "table", {}],
  ])("converts block on live Markdown shortcut %j -> %s", async (input, expectedType, attrs) => {
    const { editor, view } = await mountEditor();
    act(() => typeLiveText(editor, input));
    const first = editor.state.doc.firstChild;
    expect(first?.type.name).toBe(expectedType);
    for (const [k, v] of Object.entries(attrs)) expect(first?.attrs[k]).toBe(v);
    view.unmount();
  });
});

describe("placeSlashMenu", () => {
  const viewport = { width: 1200, height: 800 };
  const menu = { width: 260, height: 300 };

  it("opens below the caret when it fits", () => {
    expect(placeSlashMenu({ top: 100, bottom: 120, left: 300 }, menu, viewport)).toEqual({
      top: 128,
      left: 300,
      maxHeight: 664,
    });
  });

  it("flips above the caret near the bottom edge", () => {
    const placement = placeSlashMenu({ top: 700, bottom: 720, left: 300 }, menu, viewport);
    expect(placement.top).toBe(700 - 8 - 300);
    expect(placement.top + menu.height).toBeLessThanOrEqual(700);
  });

  it("caps the height and scrolls when neither side fits", () => {
    const short = { width: 1200, height: 300 };
    const placement = placeSlashMenu({ top: 140, bottom: 160, left: 300 }, menu, short);
    expect(placement.top).toBeGreaterThanOrEqual(8);
    expect(placement.top + placement.maxHeight).toBeLessThanOrEqual(short.height - 8);
  });

  it("never goes past the right or left window edge", () => {
    expect(placeSlashMenu({ top: 100, bottom: 120, left: 1100 }, menu, viewport).left).toBe(
      1200 - 260 - 8,
    );
    expect(placeSlashMenu({ top: 100, bottom: 120, left: -20 }, menu, viewport).left).toBe(8);
  });
});
