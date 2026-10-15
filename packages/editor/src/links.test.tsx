import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import {
  type Editor,
  extractDocumentTags,
  FossilEditor,
  parseInlineLinks,
  type WikilinkItem,
} from "./index";

afterEach(cleanup);

const ITEMS: readonly WikilinkItem[] = [
  { id: "obj_1", title: "Arquitectura local" },
  { id: "obj_2", title: "Plan editorial Q4" },
];

describe("Wikilinks [[ ]] and #tags (#24)", () => {
  it("parses inline [[wikilinks]] and nested #marca/acme tags", () => {
    expect(parseInlineLinks("Ver [[Plan editorial Q4]] en #marca/acme y #q4.")).toEqual([
      { kind: "wikilink", value: "Plan editorial Q4", start: 4, end: 25 },
      { kind: "tag", value: "marca/acme", start: 29, end: 40 },
      { kind: "tag", value: "q4", start: 43, end: 46 },
    ]);
  });

  it("autocompletes [[ ]] with 'Crear «X»', opens on Ctrl+click, and autocompletes #marca/acme", async () => {
    const onCreate = vi.fn();
    const onOpen = vi.fn();
    const ref: { current: Editor | null } = { current: null };
    const { container } = render(
      <FossilEditor
        doc={new Y.Doc()}
        transport={{ load: async () => new Uint8Array(), apply: async () => {} }}
        onSearchObjects={() => ITEMS}
        onCreateObject={onCreate}
        onOpenObject={onOpen}
        onSearchTags={() => ["marca/acme", "campana/2026"]}
        onReady={(e) => {
          ref.current = e;
        }}
      />,
    );
    await waitFor(() => expect(ref.current).not.toBeNull());

    ref.current?.commands.insertContent("Ir a [[Arq");
    fireEvent.mouseDown(await screen.findByRole("option", { name: "[[Arquitectura local]]" }));
    await waitFor(() => expect(ref.current?.getText()).toContain("[[Arquitectura local]]"));

    const chip = container.querySelector('[data-wikilink="Arquitectura local"]');
    expect(chip).not.toBeNull();
    if (chip) fireEvent.click(chip, { ctrlKey: true });
    expect(onOpen).toHaveBeenCalledWith("Arquitectura local", { newTab: true });

    ref.current?.commands.insertContent(" y [[Nota nueva");
    fireEvent.mouseDown(await screen.findByRole("option", { name: "Crear «Nota nueva»" }));
    expect(onCreate).toHaveBeenCalledWith("Nota nueva");
    await waitFor(() => expect(ref.current?.getText()).toContain("[[Nota nueva]]"));

    ref.current?.commands.insertContent(" en #marca/a");
    fireEvent.mouseDown(await screen.findByRole("option", { name: "#marca/acme" }));
    await waitFor(() => expect(container.querySelector('[data-tag="marca/acme"]')).not.toBeNull());
    if (ref.current) expect(extractDocumentTags(ref.current.state.doc)).toEqual(["marca/acme"]);
  });
});
