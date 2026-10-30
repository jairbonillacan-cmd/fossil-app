import { describe, expect, it } from "vitest";
import type { ObjectMeta } from "./bindings";
import { repeatedTitles, titleHint } from "./page-links";

const page = (id: string, title: string, parent: string | null = null): ObjectMeta =>
  ({
    id,
    types: ["Page"],
    title,
    icon: null,
    parent,
    created_at: "2026-10-14T03:00:00.000Z",
    updated_at: "2026-10-14T03:00:00.000Z",
    archived: false,
  }) as ObjectMeta;

describe("page links (#137)", () => {
  it("finds titles shared by two or more pages, ignoring case, spaces and untitled pages", () => {
    const set = repeatedTitles([
      page("a", "Reunión semanal"),
      page("b", " reunión SEMANAL "),
      page("c", "Plan editorial Q4"),
      page("d", ""),
      page("e", ""),
    ]);
    expect([...set]).toEqual(["reunión semanal"]);
  });

  it("hints with the parent page, or else the creation date", () => {
    const parent = page("p", "Ventas");
    const child = page("a", "Reunión semanal", "p");
    const orphan = page("b", "Reunión semanal");
    const byId = new Map([parent, child, orphan].map((o) => [o.id, o]));
    expect(titleHint(child, byId, "es-MX")).toBe("Ventas");
    expect(titleHint(orphan, byId, "es-MX")).toBe("14 oct 2026");
  });
});
