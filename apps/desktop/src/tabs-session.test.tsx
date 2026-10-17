import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { commands, type ObjectMeta } from "./bindings";
import { ShellTabs, useWorkspaceTabs } from "./shell-tabs";
import {
  loadSession,
  parseSession,
  recordScroll,
  restoreSession,
  SESSION_VERSION,
  saveSession,
  setScrollOffsets,
  type TabsSession,
} from "./tabs-session";
import "./i18n";

vi.mock("./bindings", () => ({ commands: { objectList: vi.fn() } }));

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.useRealTimers();
});

const base = JSON.parse(
  '{"types":["Page"],"icon":null,"parent":null,"created_at":"","updated_at":"","archived":false}',
) as Omit<ObjectMeta, "id" | "title">;
const obj = (n: number, archived = false): ObjectMeta => ({
  ...base,
  id: `o${n}`,
  title: `Página ${n}`,
  archived,
});
const session = (over: Partial<TabsSession> = {}): TabsSession => ({
  v: SESSION_VERSION,
  tabs: [
    { objectId: "o1", pinned: true },
    { objectId: "o2", pinned: false },
    { objectId: "o3", pinned: false },
  ],
  active: 1,
  history: ["o1", "o2", "o3"],
  historyIndex: 1,
  scroll: { o2: 340 },
  ...over,
});

describe("parseSession", () => {
  it("rejects corrupt, old-version and malformed state", () => {
    expect(parseSession(null)).toBeNull();
    expect(parseSession("{not json")).toBeNull();
    expect(parseSession("[]")).toBeNull();
    expect(parseSession(JSON.stringify({ ...session(), v: 0 }))).toBeNull();
    expect(parseSession(JSON.stringify({ ...session(), tabs: [{ objectId: 5 }] }))).toBeNull();
  });

  it("sanitizes out-of-range indices and scroll values", () => {
    const parsed = parseSession(
      JSON.stringify({
        ...session(),
        active: 99,
        historyIndex: 99,
        scroll: { o1: -4, o2: "x", o3: 10 },
      }),
    );
    expect(parsed?.active).toBeNull();
    expect(parsed?.historyIndex).toBe(2);
    expect(parsed?.scroll).toEqual({ o3: 10 });
  });

  it("round-trips through localStorage and survives unreadable storage", () => {
    saveSession("Acme", session());
    expect(loadSession("Acme")).toEqual(session());
    window.localStorage.setItem("fossil.tabs.session:Acme", "garbage");
    expect(loadSession("Acme")).toBeNull();
  });
});

describe("restoreSession", () => {
  it("drops deleted and archived pages without breaking active tab or history", () => {
    const r = restoreSession(session({ active: 2, historyIndex: 2 }), [obj(1), obj(3, true)]);
    expect(r.tabs.map((t) => t.object?.id)).toEqual(["o1"]);
    expect(r.active).toBe(0);
    expect(r.history.map((h) => h.id)).toEqual(["o1"]);
    expect(r.historyIndex).toBe(0);
  });
});

function Harness({ vault }: { vault: string | null }) {
  const t = useWorkspaceTabs([], vault);
  return (
    <div data-testid="sel" data-val={t.selectedObject?.id ?? "none"}>
      <ShellTabs {...t} />
    </div>
  );
}

describe("useWorkspaceTabs persistence (#29)", () => {
  beforeEach(() => {
    vi.mocked(commands.objectList).mockReset();
  });

  it("restores the saved session on relaunch and skips pages that no longer exist", async () => {
    saveSession("Acme", session());
    vi.mocked(commands.objectList).mockResolvedValue({ status: "ok", data: [obj(1), obj(2)] });
    render(<Harness vault="Acme" />);
    await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(2));
    expect(screen.getByTestId("sel").getAttribute("data-val")).toBe("o2");
    expect(screen.getByRole("button", { name: "Desfijar pestaña" })).toBeTruthy();
  });

  it("does not overwrite the saved session when the page list fails to load", async () => {
    saveSession("Acme", session());
    vi.mocked(commands.objectList).mockResolvedValue({
      status: "error",
      error: { Storage: "x" },
    } as never);
    render(<Harness vault="Acme" />);
    await act(async () => {});
    expect(loadSession("Acme")).toEqual(session());
  });

  it("persists scroll offsets with a debounce", async () => {
    vi.useFakeTimers();
    saveSession("Acme", session());
    vi.mocked(commands.objectList).mockResolvedValue({ status: "ok", data: [obj(1), obj(2)] });
    render(<Harness vault="Acme" />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(screen.getAllByRole("tab")).toHaveLength(2);
    act(() => recordScroll("o2", 777));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(loadSession("Acme")?.scroll.o2).toBe(777);
    setScrollOffsets({});
  });
});
