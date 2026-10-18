import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ObjectMeta } from "./bindings";
import { commands } from "./bindings";
import {
  clearCommands,
  editDistance,
  fuzzyMatch,
  listCommands,
  registerCommand,
} from "./shell-commands";
import { ShellPalette } from "./shell-palette";
import { listRecents, pruneRecents, pushRecent, resetRecentsCache } from "./shell-recents";
import "./i18n";

vi.mock("./bindings", () => ({
  commands: { objectList: vi.fn(), searchQuery: vi.fn() },
}));

const p1 = { id: "obj-1", types: ["Page"], title: "Campaña Q4", icon: null } as ObjectMeta;
const p2 = { ...p1, id: "obj-2", title: "Checklist de lanzamiento" };

beforeEach(() => {
  vi.clearAllMocks();
  clearCommands();
  vi.mocked(commands.objectList).mockResolvedValue({ status: "ok", data: [p1, p2] });
  vi.mocked(commands.searchQuery).mockResolvedValue({ status: "error", error: "NotImplemented" });
});

afterEach(() => {
  cleanup();
  clearCommands();
});

describe("shell-commands & ShellPalette (#27)", () => {
  it("registers, replaces, unregisters commands and scores fuzzy subsequences", () => {
    const off1 = registerCommand({ id: "c1", title: "Acción A", shortcut: "Ctrl+1", run() {} });
    expect(listCommands()).toHaveLength(1);
    const off2 = registerCommand({ id: "c1", title: "Acción B", run() {} });
    off1();
    expect(listCommands().map((c) => c.title)).toEqual(["Acción B"]);
    off2();
    expect(listCommands()).toHaveLength(0);

    const exact = fuzzyMatch("campana", "Campaña Q4");
    const sparse = fuzzyMatch("campana", "Cierre anual de mañana para análisis");
    expect(exact?.indices).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect((exact?.score ?? 0) > (sparse?.score ?? 0)).toBe(true);
    expect(fuzzyMatch("xyz", "Campaña Q4")).toBeNull();
  });

  it("opens on Ctrl+K, runs commands, falls back from searchQuery NotImplemented to objectList, and restores focus", async () => {
    const runCmd = vi.fn();
    registerCommand({ id: "shell.newPage", title: "Nueva página", run: runCmd });
    render(
      <div>
        <button type="button">Origen</button>
        <ShellPalette />
      </div>,
    );
    const opener = screen.getByRole("button", { name: "Origen" });
    opener.focus();

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const input = await screen.findByRole("combobox", { name: "Paleta de comandos" });
    expect(document.activeElement).toBe(input);
    await screen.findByRole("option", { name: /Campaña Q4/ });

    fireEvent.change(input, { target: { value: "campana" } });
    await vi.waitFor(() => expect(commands.searchQuery).toHaveBeenCalled());
    expect(screen.getByRole("option", { name: /Campaña Q4/ })).not.toBeNull();

    fireEvent.change(input, { target: { value: "Nueva" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(runCmd).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("opens quick switcher on Ctrl+P, highlights matches and navigates with ArrowDown/Enter", async () => {
    const onSelect = vi.fn();
    render(<ShellPalette onSelect={onSelect} />);

    fireEvent.keyDown(window, { key: "p", ctrlKey: true });
    const input = await screen.findByRole("combobox", { name: "Cambio rápido de página" });
    await screen.findByRole("option", { name: /Checklist de lanzamiento/ });

    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledWith(p2);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("typo-tolerant search and recents (#86)", () => {
  beforeEach(() => {
    localStorage.clear();
    resetRecentsCache();
  });

  it("finds 'Exportar PDF' from misspelled queries and still rejects unrelated text", () => {
    expect(fuzzyMatch("exprtar pdf", "Exportar PDF")).not.toBeNull();
    const swapped = fuzzyMatch("exprot pdf", "Exportar PDF");
    expect(swapped).not.toBeNull();
    expect(swapped?.indices.length).toBeGreaterThan(0);
    expect(fuzzyMatch("exportr pfd", "Exportar PDF")).toBeNull();
    expect(fuzzyMatch("crear paginna", "Crear página")).not.toBeNull();
    expect(fuzzyMatch("zzzzzz", "Exportar PDF")).toBeNull();
    expect(editDistance("abcd", "abdc")).toBe(1);
  });

  it("does not tolerate lookalike words and never swaps the first letter", () => {
    expect(fuzzyMatch("exportar", "Importar CSV")).toBeNull();
    expect(fuzzyMatch("importar", "Exportar PDF")).toBeNull();
    expect(fuzzyMatch("ventas", "Vientos del norte")).toBeNull();
    expect(fuzzyMatch("exportra", "Exportar PDF")).not.toBeNull();
  });

  it("keeps typo search close to the exact pass on 10 000 titles", () => {
    const words = [
      "campaña",
      "reporte",
      "ventas",
      "lanzamiento",
      "verano",
      "notas",
      "plan",
      "marca",
    ];
    const titles = Array.from(
      { length: 10_000 },
      (_, i) => `${words[i % 8]} ${words[(i * 3) % 8]} ${i}`,
    );
    const run = (q: string, typo: boolean) => {
      const t0 = performance.now();
      let n = 0;
      for (const t of titles) if (fuzzyMatch(q, t, { typo })) n++;
      return { ms: performance.now() - t0, n };
    };
    for (const q of ["zz", "campana veranp", "reporte"]) {
      run(q, false);
      const exact = run(q, false);
      const tolerant = run(q, true);
      // biome-ignore lint/suspicious/noConsole: bench timings are useful in CI logs
      console.info(
        `bench ${q}: exact ${exact.ms.toFixed(0)} ms, typo ${tolerant.ms.toFixed(0)} ms`,
      );
      expect(tolerant.ms).toBeLessThan(Math.max(exact.ms * 3, 400));
      expect(tolerant.ms).toBeLessThan(2000);
    }
  });

  it("prunes recent pages that no longer exist", () => {
    for (const id of ["a", "b", "c"]) pushRecent("pages", id);
    pruneRecents("pages", new Set(["a", "c"]));
    expect(listRecents("pages")).toEqual(["c", "a"]);
  });

  it("lists the last 5 actions under Recientes on Ctrl+K and the last pages on Ctrl+P", async () => {
    const ids = ["a", "b", "c", "d", "e", "f"];
    for (const id of ids) registerCommand({ id, title: `Acción ${id}`, run() {} });
    pushRecent("actions", "a");
    for (const id of ids) pushRecent("actions", id);
    pushRecent("pages", "obj-2");
    render(<ShellPalette />);
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    await screen.findByRole("option", { name: /Campaña Q4/ });
    expect(screen.getByText("Recientes")).toBeTruthy();
    const names = screen.getAllByRole("option").map((o) => o.textContent ?? "");
    expect(names.slice(0, 5).map((n) => n.slice(0, 8))).toEqual([
      "Acción f",
      "Acción e",
      "Acción d",
      "Acción c",
      "Acción b",
    ]);
    expect(names[5]).toMatch(/^Acción a/);

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    fireEvent.keyDown(window, { key: "p", ctrlKey: true });
    await screen.findByRole("option", { name: /Checklist/ });
    expect(screen.getAllByRole("option")[0]?.textContent).toMatch(/^Checklist/);
    expect(screen.getByText("Recientes")).toBeTruthy();
  });

  it("records an action when it runs", async () => {
    registerCommand({ id: "x", title: "Crear página", run() {} });
    render(<ShellPalette />);
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    fireEvent.click(await screen.findByRole("option", { name: /Crear página/ }));
    expect(listRecents("actions")).toEqual(["x"]);
  });
});
