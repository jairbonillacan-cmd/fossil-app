import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import type { Link, ObjectMeta } from "./bindings";
import { commands, events } from "./bindings";
import { PageEditor } from "./page-editor";
import { replaceFirstUnlinkedMentionInDoc } from "./page-editor-backlinks";
import "./i18n";

vi.mock("./page-body", () => ({
  PageBody: ({ objectId }: { objectId: string }) => <div data-testid="page-body">{objectId}</div>,
}));

vi.mock("./bindings", () => ({
  commands: {
    objectList: vi.fn(),
    objectUpdateMeta: vi.fn(),
    objectLoadDoc: vi.fn(),
    objectApplyUpdate: vi.fn(),
    linksBacklinks: vi.fn(),
    linksUnlinkedMentions: vi.fn(),
  },
  events: { objectChanged: { listen: vi.fn() }, indexUpdated: { listen: vi.fn() } },
}));

afterEach(cleanup);

const target = {
  id: "obj-target",
  types: ["Page"],
  title: "Árbol Trimestral",
  icon: null,
  parent: null,
  created_at: "",
  updated_at: "",
  archived: false,
} satisfies ObjectMeta;
const source: ObjectMeta = { ...target, id: "obj-src", title: "Notas de coordinación" };
const note: ObjectMeta = { ...target, id: "obj-note", title: "Bitácora semanal" };

function makeBodyDoc(paragraphs: string[]): Y.Doc {
  const doc = new Y.Doc();
  const body = doc.getXmlFragment("body");
  for (const text of paragraphs) {
    const p = new Y.XmlElement("paragraph");
    p.insert(0, [new Y.XmlText(text)]);
    body.insert(body.length, [p]);
  }
  return doc;
}

function readBodyText(update: number[]): string {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, Uint8Array.from(update));
  const text = doc.getXmlFragment("body").toDOM().textContent ?? "";
  doc.destroy();
  return text;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(commands.objectList).mockResolvedValue({ status: "ok", data: [target, source, note] });
  vi.mocked(commands.linksBacklinks).mockResolvedValue({ status: "ok", data: [] });
  vi.mocked(commands.linksUnlinkedMentions).mockResolvedValue({ status: "ok", data: [] });
  vi.mocked(events.objectChanged.listen).mockResolvedValue(() => {});
  vi.mocked(events.indexUpdated.listen).mockResolvedValue(() => {});
});

describe("PageBacklinksPanel (#28)", () => {
  it("shows localized empty states and toggles the right panel", async () => {
    render(<PageEditor object={target} />);
    expect(await screen.findByText("Ninguna otra página enlaza aquí todavía.")).not.toBeNull();
    expect(screen.getByText(/No hay menciones sin enlace/)).not.toBeNull();
    const toggle = screen.getByRole("button", { name: "Enlazada desde" });
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("complementary", { name: "Enlazada desde" })).toBeNull();
  });

  it("renders backlinks with title and context, opens source on click, and reloads on index:updated", async () => {
    let onIndexed: (() => void) | undefined;
    vi.mocked(events.indexUpdated.listen).mockImplementation((cb) => {
      onIndexed = () => cb({ event: "index:updated", id: 1, payload: {} });
      return Promise.resolve(() => {});
    });
    const link: Link = {
      from_object: "obj-src",
      from_block: "blk-2",
      to_object: "obj-target",
      to_block: null,
      kind: "Wikilink",
    };
    vi.mocked(commands.linksBacklinks).mockResolvedValue({ status: "ok", data: [link] });
    const onSelect = vi.fn();
    render(<PageEditor object={target} onSelect={onSelect} />);
    fireEvent.click(await screen.findByRole("button", { name: /Notas de coordinación/ }));
    expect(screen.getByText("Wikilink · #blk-2")).not.toBeNull();
    expect(onSelect).toHaveBeenCalledWith(source);
    await act(async () => onIndexed?.());
    await vi.waitFor(() => expect(commands.linksBacklinks).toHaveBeenCalledTimes(2));
  });

  it("links the first unlinked mention in Y.XmlFragment('body') and refreshes lists", async () => {
    const doc = makeBodyDoc([
      "Ya enlazado [[Árbol Trimestral]] aquí. ",
      "Revisar árbol trimestral y otro árbol trimestral mañana.",
    ]);
    const initial = Array.from(Y.encodeStateAsUpdate(doc));
    doc.destroy();
    const mention = { object_id: "obj-note", snippet: "Revisar árbol trimestral" };
    vi.mocked(commands.linksUnlinkedMentions)
      .mockResolvedValueOnce({ status: "ok", data: [mention] })
      .mockResolvedValue({ status: "ok", data: [] });
    vi.mocked(commands.objectLoadDoc).mockResolvedValue({ status: "ok", data: initial });
    vi.mocked(commands.objectApplyUpdate).mockResolvedValue({ status: "ok", data: null });

    render(<PageEditor object={target} />);
    expect(await screen.findByText("Bitácora semanal")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Enlazar" }));

    await vi.waitFor(() => expect(commands.objectApplyUpdate).toHaveBeenCalledTimes(1));
    const [updatedId, updateBytes] = vi.mocked(commands.objectApplyUpdate).mock.calls[0] ?? [];
    expect(updatedId).toBe("obj-note");
    expect(readBodyText(updateBytes ?? [])).toBe(
      "Ya enlazado [[Árbol Trimestral]] aquí. Revisar [[Árbol Trimestral]] y otro árbol trimestral mañana.",
    );
    await screen.findByText(/No hay menciones sin enlace/);
  });

  it("ignores partial-word matches when replacing mentions in a Y.Doc", () => {
    const doc = makeBodyDoc(["Una parte del arte moderno"]);
    expect(replaceFirstUnlinkedMentionInDoc(doc, "Arte")).toBe(true);
    expect(readBodyText(Array.from(Y.encodeStateAsUpdate(doc)))).toBe(
      "Una parte del [[Arte]] moderno",
    );
    doc.destroy();
  });

  it("sanitizes wikilink delimiters ([, ], |, #) when inserting [[title]] (#51)", () => {
    const doc = makeBodyDoc(["Revisar Plan [Q4] | #1 mañana"]);
    expect(replaceFirstUnlinkedMentionInDoc(doc, "Plan [Q4] | #1")).toBe(true);
    expect(readBodyText(Array.from(Y.encodeStateAsUpdate(doc)))).toBe(
      "Revisar [[Plan Q4 1]] mañana",
    );
    doc.destroy();
  });
});
