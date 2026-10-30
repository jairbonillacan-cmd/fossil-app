import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import {
  type Editor,
  extractDocumentTags,
  FossilEditor,
  parseInlineLinks,
  splitWikilink,
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

const ID_A = "01JABCDEFGHJKMNPQRSTVWXYZ0";
const ID_B = "01JABCDEFGHJKMNPQRSTVWXYZ1";
const TWINS: readonly WikilinkItem[] = [
  { id: ID_A, title: "Reunión semanal", hint: "Ventas" },
  { id: ID_B, title: "Reunión semanal", hint: "Producto" },
  { id: "01JABCDEFGHJKMNPQRSTVWXYZ2", title: "Plan editorial Q4" },
];

function renderEditor(ambiguousTitles?: ReadonlySet<string>) {
  const ref: { current: Editor | null } = { current: null };
  const view = render(
    <FossilEditor
      doc={new Y.Doc()}
      transport={{ load: async () => new Uint8Array(), apply: async () => {} }}
      onSearchObjects={() => TWINS}
      {...(ambiguousTitles ? { ambiguousTitles } : {})}
      onReady={(e) => {
        ref.current = e;
      }}
    />,
  );
  return { ...view, ref };
}

describe("Repeated titles in [[ ]] (#137)", () => {
  it("splits the id form from a plain title or alias", () => {
    expect(splitWikilink(`${ID_A}|Reunión semanal`)).toEqual({
      id: ID_A,
      title: "Reunión semanal",
    });
    expect(splitWikilink(`${ID_A}#blk-1|Reunión semanal`)).toEqual({
      id: ID_A,
      title: "Reunión semanal",
    });
    expect(splitWikilink("Plan editorial Q4|el plan")).toEqual({
      id: null,
      title: "Plan editorial Q4",
    });
  });

  it("lists repeated titles apart and saves the chosen one by id", async () => {
    const { container, ref } = renderEditor();
    await waitFor(() => expect(ref.current).not.toBeNull());

    ref.current?.commands.insertContent("Ver [[Reunión");
    expect(
      await screen.findByRole("option", { name: "[[Reunión semanal]] · Ventas" }),
    ).toBeTruthy();
    fireEvent.mouseDown(screen.getByRole("option", { name: "[[Reunión semanal]] · Producto" }));

    await waitFor(() => expect(ref.current?.getText()).toContain(`[[${ID_B}|Reunión semanal]]`));
    // Overlapping decorations split the chip; together the pieces are the whole link.
    const parts = container.querySelectorAll(`[data-wikilink="${ID_B}|Reunión semanal"]`);
    expect([...parts].map((p) => p.textContent).join("")).toBe(`[[${ID_B}|Reunión semanal]]`);
    expect(container.querySelector(".fossil-wikilink-id")?.textContent).toBe(`${ID_B}|`);
  });

  it("marks a hand-typed repeated title and replaces it with the page picked", async () => {
    const { container, ref } = renderEditor(new Set(["reunión semanal"]));
    await waitFor(() => expect(ref.current).not.toBeNull());

    ref.current?.commands.setContent("<p>Ver [[Reunión semanal]] hoy</p>");
    const chip = await waitFor(() => {
      const el = container.querySelector('[data-ambiguous="true"]');
      expect(el).not.toBeNull();
      return el as Element;
    });
    expect(chip.getAttribute("title")).toBe(
      "Varias páginas tienen este título: haz clic para elegir una",
    );

    fireEvent.click(chip);
    const picker = await screen.findByRole("listbox", { name: "Elige la página" });
    expect(picker.textContent).not.toContain("Plan editorial Q4");
    fireEvent.mouseDown(screen.getByRole("option", { name: "Reunión semanal · Ventas" }));

    await waitFor(() => expect(ref.current?.getText()).toBe(`Ver [[${ID_A}|Reunión semanal]] hoy`));
    expect(container.querySelector('[data-ambiguous="true"]')).toBeNull();
  });
});

describe("Repeated titles keep a typed alias (#137)", () => {
  it("rewrites [[Título|alias]] to the id form without losing the alias", async () => {
    const { container, ref } = renderEditor(new Set(["reunión semanal"]));
    await waitFor(() => expect(ref.current).not.toBeNull());
    ref.current?.commands.setContent("<p>Ver [[Reunión semanal|el plan del equipo]]</p>");
    const chip = await waitFor(() => {
      const el = container.querySelector('[data-ambiguous="true"]');
      expect(el).not.toBeNull();
      return el as Element;
    });
    fireEvent.click(chip);
    fireEvent.mouseDown(await screen.findByRole("option", { name: "Reunión semanal · Producto" }));
    await waitFor(() => expect(ref.current?.getText()).toBe(`Ver [[${ID_B}|el plan del equipo]]`));
  });
});
