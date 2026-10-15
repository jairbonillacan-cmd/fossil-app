import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ObjectMeta, SearchHit } from "./bindings";
import { commands } from "./bindings";
import { findTextRanges, PageFindBar, SEARCH_DEBOUNCE_MS, ShellSearch } from "./shell-search";
import "./i18n";

vi.mock("./bindings", () => ({
  commands: { objectList: vi.fn(), searchQuery: vi.fn() },
}));

const p1 = { id: "obj-1", types: ["Page"], title: "Campaña Q4", icon: null } as ObjectMeta;
const j1 = { id: "obj-2", types: ["Journal"], title: "2026-10-14", icon: null } as ObjectMeta;
const hits: SearchHit[] = [
  {
    object_id: "obj-1",
    title: "Campaña Q4",
    snippet: [{ text: "campaña", matched: true }],
    score: 1,
  },
  {
    object_id: "obj-2",
    title: "2026-10-14",
    snippet: [{ text: "Notas", matched: true }],
    score: 1,
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(commands.objectList).mockResolvedValue({ status: "ok", data: [p1, j1] });
  vi.mocked(commands.searchQuery).mockResolvedValue({ status: "ok", data: hits });
});
afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe("ShellSearch & PageFindBar (#29)", () => {
  it("debounces searchQuery by 80 ms, passes filters, groups hits and highlights <mark>", async () => {
    vi.useFakeTimers();
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(<ShellSearch open={true} onClose={onClose} onSelect={onSelect} />);
    await act(async () => vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS));
    const markIn = (name: string) => screen.getByRole("region", { name }).querySelector("mark");
    expect(markIn("Páginas")?.textContent).toBe("campaña");
    expect(markIn("Bitácora")?.textContent).toBe("Notas");
    vi.mocked(commands.searchQuery).mockClear();

    fireEvent.change(screen.getByRole("searchbox", { name: "Búsqueda global" }), {
      target: { value: "campana" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Bitácora" }));
    fireEvent.change(screen.getByLabelText("Etiqueta"), { target: { value: "#q4" } });
    fireEvent.change(screen.getByLabelText("Desde"), { target: { value: "2026-10-01" } });
    fireEvent.change(screen.getByLabelText("Hasta"), { target: { value: "2026-10-31" } });

    await act(async () => vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS - 10));
    expect(commands.searchQuery).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTime(20));
    expect(commands.searchQuery).toHaveBeenCalledWith({
      text: "campana",
      type_key: "Journal",
      tag: "q4",
      updated_from: "2026-10-01T00:00:00.000Z",
      updated_to: "2026-10-31T23:59:59.999Z",
      limit: 50,
    });
    fireEvent.click(screen.getByRole("button", { name: /Campaña Q4/ }));
    expect(onSelect).toHaveBeenCalledWith(p1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("opens in-page find bar on Ctrl+F, counts diacritic-insensitive matches, steps and closes on Escape", async () => {
    const ref = createRef<HTMLParagraphElement>();
    const { container } = render(
      <div>
        <PageFindBar containerRef={ref} />
        <p ref={ref}>La campaña de otoño inicia hoy. Revisar metricas de campana.</p>
      </div>,
    );
    expect(findTextRanges(container, "campana")).toHaveLength(2);
    fireEvent.keyDown(window, { key: "f", ctrlKey: true });
    const input = await screen.findByRole("searchbox", { name: "Buscar en la página" });
    fireEvent.change(input, { target: { value: "campana" } });
    expect(screen.getByText("1 / 2")).not.toBeNull();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByText("2 / 2")).not.toBeNull();
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(screen.getByText("1 / 2")).not.toBeNull();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("search")).toBeNull();
  });
});
