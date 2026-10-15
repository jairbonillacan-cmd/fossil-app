import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ObjectMeta } from "./bindings";
import { commands, events } from "./bindings";
import { PageEditor } from "./page-editor";
import { formatObjectTitle, Sidebar } from "./sidebar";
import "./i18n";

// The real editor is covered in page-body.test.tsx; keep these tests fast.
vi.mock("./page-body", () => ({
  PageBody: ({ objectId }: { objectId: string }) => <div data-testid="page-body">{objectId}</div>,
}));

vi.mock("./bindings", () => ({
  commands: {
    appInfo: vi.fn(),
    objectList: vi.fn(),
    objectCreate: vi.fn(),
    objectUpdateMeta: vi.fn(),
    journalToday: vi.fn(),
  },
  events: {
    objectChanged: { listen: vi.fn() },
    indexUpdated: { listen: vi.fn() },
  },
}));

afterEach(cleanup);

const page: ObjectMeta = {
  id: "obj-1",
  types: ["Page"],
  title: "Launch checklist",
  icon: null,
  parent: null,
  created_at: "2026-10-14T03:00:00.000Z",
  updated_at: "2026-10-14T03:00:00.000Z",
  archived: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(commands.appInfo).mockResolvedValue({
    status: "ok",
    data: { version: "0.0.1", data_dir: "C:\\Data" },
  });
  vi.mocked(commands.objectList).mockResolvedValue({ status: "ok", data: [] });
  vi.mocked(events.objectChanged.listen).mockResolvedValue(() => {});
  vi.mocked(events.indexUpdated.listen).mockResolvedValue(() => {});
});

describe("Sidebar & PageEditor", () => {
  it("lists objects and formats ISO journal dates with i18n", async () => {
    const journal: ObjectMeta = { ...page, id: "obj-j", types: ["Journal"], title: "2026-10-14" };
    vi.mocked(commands.objectList).mockResolvedValue({ status: "ok", data: [page, journal] });
    const onSelect = vi.fn();
    render(<Sidebar vaultName="Acme" selectedId="obj-1" onSelect={onSelect} />);
    const row = await screen.findByRole("button", { name: "Launch checklist" });
    expect(row.getAttribute("aria-current")).toBe("true");
    fireEvent.click(row);
    expect(onSelect).toHaveBeenCalledWith(page);
    expect(
      screen.getByRole("button", { name: formatObjectTitle(journal, "es-MX", "Sin título") }),
    ).not.toBeNull();
  });

  it("shows empty state, creates pages, opens today, and refetches on object:changed", async () => {
    let onChanged: (() => void) | undefined;
    vi.mocked(events.objectChanged.listen).mockImplementation((cb) => {
      onChanged = () => cb({ event: "object:changed", id: 1, payload: { id: "obj-1" } });
      return Promise.resolve(() => {});
    });
    const created: ObjectMeta = { ...page, id: "obj-2", title: "" };
    const journal: ObjectMeta = { ...page, id: "obj-3", types: ["Journal"], title: "2026-10-14" };
    vi.mocked(commands.objectCreate).mockResolvedValue({ status: "ok", data: created });
    vi.mocked(commands.journalToday).mockResolvedValue({ status: "ok", data: journal });
    const onSelect = vi.fn();
    render(<Sidebar vaultName="Acme" selectedId={null} onSelect={onSelect} />);
    await screen.findByText("Todavía no hay páginas. Crea la primera con «Nueva página».");
    fireEvent.click(screen.getByRole("button", { name: "Nueva página" }));
    await vi.waitFor(() => expect(onSelect).toHaveBeenCalledWith(created));
    fireEvent.click(screen.getByRole("button", { name: "Hoy" }));
    await vi.waitFor(() => expect(onSelect).toHaveBeenCalledWith(journal));
    await act(async () => onChanged?.());
    await vi.waitFor(() => expect(commands.objectList).toHaveBeenCalledTimes(4));
  });

  it("renders the page body for the object and commits title edits on blur", async () => {
    vi.mocked(commands.objectUpdateMeta).mockResolvedValue({ status: "ok", data: page });
    render(<PageEditor object={page} />);
    expect((await screen.findByTestId("page-body")).textContent).toBe("obj-1");
    const input = screen.getByRole("textbox", { name: "Título de la página" });
    fireEvent.change(input, { target: { value: "Roadmap Q4" } });
    fireEvent.blur(input);
    expect(commands.objectUpdateMeta).toHaveBeenCalledWith("obj-1", {
      title: "Roadmap Q4",
      icon: null,
      types: null,
      archived: null,
    });
  });

  it("does not subscribe to index:updated and reuses cached Intl.DateTimeFormat per locale (#52)", async () => {
    render(<Sidebar vaultName="Acme" selectedId={null} onSelect={vi.fn()} />);
    await screen.findByText("Todavía no hay páginas. Crea la primera con «Nueva página».");
    expect(events.objectChanged.listen).toHaveBeenCalledTimes(1);
    expect(events.indexUpdated.listen).not.toHaveBeenCalled();

    const journals: ObjectMeta[] = Array.from({ length: 500 }, (_, i) => ({
      ...page,
      id: `j-${i}`,
      types: ["Journal"],
      title: `2026-${String((i % 12) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`,
    }));
    const t0 = performance.now();
    for (let r = 0; r < 10; r++) {
      for (const j of journals) {
        formatObjectTitle(j, "es-MX", "Sin título");
      }
    }
    const elapsedMs = performance.now() - t0;
    expect(elapsedMs).toBeLessThan(500);
  });
});

describe("Sidebar edge cases", () => {
  it("shows the untitled label for pages with an empty title", async () => {
    vi.mocked(commands.objectList).mockResolvedValue({
      status: "ok",
      data: [{ ...page, id: "obj-blank", title: "" }],
    });
    render(<Sidebar vaultName="Acme" selectedId={null} onSelect={vi.fn()} />);
    expect(await screen.findByRole("button", { name: "Sin título" })).not.toBeNull();
  });

  it("renders titles with emoji as-is", async () => {
    vi.mocked(commands.objectList).mockResolvedValue({
      status: "ok",
      data: [{ ...page, id: "obj-emoji", title: "🦖 Plan Q4 Acme", icon: "🦖" }],
    });
    render(<Sidebar vaultName="Mi equipo" selectedId={null} onSelect={vi.fn()} />);
    // The icon span is aria-hidden: the accessible name comes from the title only.
    const row = await screen.findByRole("button", { name: "🦖 Plan Q4 Acme" });
    expect(row.querySelector('[aria-hidden="true"]')?.textContent).toBe("🦖");
  });

  it("renders a 200-character title without truncating the model", async () => {
    const longTitle = `Plan ${"Q".repeat(191)} fin`;
    expect(longTitle.length).toBe(200);
    vi.mocked(commands.objectList).mockResolvedValue({
      status: "ok",
      data: [{ ...page, id: "obj-long", title: longTitle }],
    });
    render(<Sidebar vaultName="Acme" selectedId={null} onSelect={vi.fn()} />);
    const row = await screen.findByRole("button", { name: longTitle });
    expect(row.textContent).toBe(longTitle);
  });
});
