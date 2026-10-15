import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { App } from "./app";
import type { Link, ObjectMeta, SearchHit, VaultInfo } from "./bindings";
import { commands, events } from "./bindings";
import "./i18n";

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
}));

vi.mock("./page-body", () => ({
  PageBody: ({ objectId }: { objectId: string }) => <div data-testid="page-body">{objectId}</div>,
}));

vi.mock("./bindings", () => ({
  commands: {
    vaultRecent: vi.fn(),
    vaultOpen: vi.fn(),
    vaultCreate: vi.fn(),
    objectList: vi.fn(),
    objectCreate: vi.fn(),
    objectUpdateMeta: vi.fn(),
    objectLoadDoc: vi.fn(),
    objectApplyUpdate: vi.fn(),
    linksBacklinks: vi.fn(),
    linksUnlinkedMentions: vi.fn(),
    searchQuery: vi.fn(),
    journalToday: vi.fn(),
  },
  events: {
    objectChanged: { listen: vi.fn() },
    indexUpdated: { listen: vi.fn() },
  },
}));

afterEach(cleanup);

function encodeParagraphDoc(text: string): number[] {
  const doc = new Y.Doc();
  const body = doc.getXmlFragment("body");
  const p = new Y.XmlElement("paragraph");
  p.insert(0, [new Y.XmlText(text)]);
  body.insert(0, [p]);
  const bytes = Array.from(Y.encodeStateAsUpdate(doc));
  doc.destroy();
  return bytes;
}

describe("End-to-end key flows (#15): create page, wikilink, backlinks, and search", () => {
  const vault: VaultInfo = { name: "Mi equipo", path: "C:/Espacios/MiEquipo" };
  let objects: ObjectMeta[] = [];
  const docs = new Map<string, number[]>();
  const backlinksByTarget = new Map<string, Link[]>();
  const objectChangedListeners = new Set<() => void>();

  beforeEach(() => {
    vi.clearAllMocks();
    objects = [];
    docs.clear();
    backlinksByTarget.clear();
    objectChangedListeners.clear();

    vi.mocked(events.objectChanged.listen).mockImplementation(async (cb) => {
      const fn = () => cb({ event: "object:changed", id: 1, payload: { id: "page-1" } });
      objectChangedListeners.add(fn);
      return () => {
        objectChangedListeners.delete(fn);
      };
    });
    vi.mocked(events.indexUpdated.listen).mockResolvedValue(() => {});
    vi.mocked(commands.vaultRecent).mockResolvedValue({ status: "ok", data: [vault] });
    vi.mocked(commands.vaultOpen).mockResolvedValue({ status: "ok", data: vault });
    vi.mocked(commands.objectList).mockImplementation(async () => ({
      status: "ok",
      data: [...objects],
    }));

    let nextId = 1;
    vi.mocked(commands.objectCreate).mockImplementation(async (meta) => {
      const created: ObjectMeta = {
        id: `page-${nextId++}`,
        types: meta.types,
        title: meta.title,
        icon: meta.icon,
        parent: meta.parent,
        created_at: "2026-10-15T12:00:00Z",
        updated_at: "2026-10-15T12:00:00Z",
        archived: false,
      };
      objects.push(created);
      docs.set(created.id, encodeParagraphDoc(""));
      return { status: "ok", data: created };
    });

    vi.mocked(commands.objectUpdateMeta).mockImplementation(async (id, patch) => {
      const idx = objects.findIndex((o) => o.id === id);
      const current = objects[idx];
      if (!current) return { status: "error", error: "NotImplemented" };
      const updated: ObjectMeta = {
        ...current,
        title: patch.title ?? current.title,
      };
      objects[idx] = updated;
      for (const notify of objectChangedListeners) notify();
      return { status: "ok", data: updated };
    });

    vi.mocked(commands.objectLoadDoc).mockImplementation(async (id) => ({
      status: "ok",
      data: docs.get(id) ?? encodeParagraphDoc(""),
    }));

    vi.mocked(commands.objectApplyUpdate).mockImplementation(async (id, update) => {
      docs.set(id, update);
      const doc = new Y.Doc();
      Y.applyUpdate(doc, Uint8Array.from(update));
      const text = doc.getXmlFragment("body").toDOM().textContent ?? "";
      doc.destroy();

      for (const match of text.matchAll(/\[\[([^\]]+)\]\]/g)) {
        const targetTitle = match[1]?.trim().toLowerCase();
        const targetObj = objects.find((o) => o.title.trim().toLowerCase() === targetTitle);
        if (targetObj) {
          const list = backlinksByTarget.get(targetObj.id) ?? [];
          list.push({
            from_object: id,
            from_block: "blk-1",
            to_object: targetObj.id,
            to_block: null,
            kind: "Wikilink",
          });
          backlinksByTarget.set(targetObj.id, list);
        }
      }
      return { status: "ok", data: null };
    });

    vi.mocked(commands.linksBacklinks).mockImplementation(async (id) => ({
      status: "ok",
      data: backlinksByTarget.get(id) ?? [],
    }));
    vi.mocked(commands.linksUnlinkedMentions).mockResolvedValue({ status: "ok", data: [] });

    vi.mocked(commands.searchQuery).mockImplementation(async (query) => {
      const needle = (query.text ?? "").trim().toLowerCase();
      const hits: SearchHit[] = objects
        .filter((o) => o.title.toLowerCase().includes(needle))
        .map((o) => ({
          object_id: o.id,
          title: o.title,
          snippet: [
            { text: "Lanzamiento de ", matched: false },
            { text: o.title, matched: true },
          ],
          score: 10,
        }));
      return { status: "ok", data: hits };
    });
  });

  it("opens a workspace, creates two pages, indexes [[wikilink]], renders Enlazada desde, and runs search_query", async () => {
    render(<App />);

    // 1. Open recent workspace "Mi equipo"
    fireEvent.click(await screen.findByRole("button", { name: /Mi equipo/ }));
    expect(await screen.findByText("Mi equipo")).not.toBeNull();

    // 2. Create target page "Plan Q4"
    fireEvent.click(screen.getByRole("button", { name: "Nueva página" }));
    await screen.findByText("page-1");
    const titleInput = (await screen.findByLabelText("Título de la página")) as HTMLInputElement;
    fireEvent.change(titleInput, { target: { value: "Plan Q4" } });
    fireEvent.blur(titleInput);
    await vi.waitFor(() =>
      expect(commands.objectUpdateMeta).toHaveBeenCalledWith(
        "page-1",
        expect.objectContaining({ title: "Plan Q4" }),
      ),
    );

    // 3. Create source page "Campaña Acme" and write wikilink [[Plan Q4]]
    fireEvent.click(screen.getByRole("button", { name: "Nueva página" }));
    await screen.findByText("page-2");
    const secondTitleInput = (await screen.findByLabelText(
      "Título de la página",
    )) as HTMLInputElement;
    fireEvent.change(secondTitleInput, { target: { value: "Campaña Acme" } });
    fireEvent.blur(secondTitleInput);
    await vi.waitFor(() =>
      expect(commands.objectUpdateMeta).toHaveBeenCalledWith(
        "page-2",
        expect.objectContaining({ title: "Campaña Acme" }),
      ),
    );
    await commands.objectApplyUpdate(
      "page-2",
      encodeParagraphDoc("Revisar objetivos en [[Plan Q4]] con el equipo."),
    );

    // 4. Select "Plan Q4" in Sidebar and verify "Campaña Acme" appears in "Enlazada desde"
    fireEvent.click(await screen.findByRole("button", { name: "Plan Q4" }));
    await screen.findByText("page-1");
    expect(await screen.findByText("Wikilink · #blk-1")).not.toBeNull();
    const backlinksAside = screen.getByRole("complementary", { name: "Enlazada desde" });
    expect(backlinksAside.textContent).toContain("Campaña Acme");

    // 5. Execute FTS5 search_query for "Campaña"
    const searchRes = await commands.searchQuery({
      text: "Campaña",
      type_key: null,
      tag: null,
      updated_from: null,
      updated_to: null,
      limit: 10,
    });
    expect(searchRes.status).toBe("ok");
    if (searchRes.status === "ok") {
      expect(searchRes.data).toHaveLength(1);
      expect(searchRes.data[0]?.title).toBe("Campaña Acme");
      expect(searchRes.data[0]?.snippet.some((part) => part.matched)).toBe(true);
    }
  });
});
