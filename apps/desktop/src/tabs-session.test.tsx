import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { commands, events, type ObjectMeta } from "./bindings";
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

vi.mock("./bindings", () => ({
  commands: { objectList: vi.fn() },
  events: { objectChanged: { listen: vi.fn() } },
}));

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
const tab = (id: string, pinned = false, history = [id], historyIndex = history.indexOf(id)) => ({
  objectId: id,
  pinned,
  history,
  historyIndex,
});
const session = (over: Partial<TabsSession> = {}): TabsSession => ({
  v: SESSION_VERSION,
  tabs: [tab("o1", true), tab("o2", false, ["o1", "o2", "o3"]), tab("o3")],
  active: 1,
  scroll: { o2: 340 },
  ...over,
});

describe("parseSession", () => {
  it("rejects corrupt, unknown-version and malformed state", () => {
    expect(parseSession(null)).toBeNull();
    expect(parseSession("{not json")).toBeNull();
    expect(parseSession("[]")).toBeNull();
    expect(parseSession(JSON.stringify({ ...session(), v: 0 }))).toBeNull();
    expect(parseSession(JSON.stringify({ ...session(), v: 3 }))).toBeNull();
    expect(parseSession(JSON.stringify({ ...session(), tabs: [{ objectId: 5 }] }))).toBeNull();
  });

  it("migrates a v1 session: keeps tabs and scroll, drops the global history", () => {
    const v1 = {
      v: 1,
      tabs: [
        { objectId: "o1", pinned: true },
        { objectId: null, pinned: false },
      ],
      active: 0,
      history: ["o1", "o2"],
      historyIndex: 1,
      scroll: { o1: 20 },
    };
    const parsed = parseSession(JSON.stringify(v1));
    expect(parsed?.v).toBe(SESSION_VERSION);
    expect(parsed?.tabs).toEqual([
      tab("o1", true),
      { objectId: null, pinned: false, history: [], historyIndex: -1 },
    ]);
    expect(parsed?.scroll).toEqual({ o1: 20 });
  });

  it("trims scroll to the ids of live tabs and history", () => {
    const parsed = parseSession(
      JSON.stringify(session({ scroll: { o1: 5, o2: 6, o9: 7, ghost: 8 } })),
    );
    expect(parsed?.scroll).toEqual({ o1: 5, o2: 6 });
    const many = Object.fromEntries(Array.from({ length: 5000 }, (_, i) => [`x${i}`, 10]));
    const trimmed = parseSession(JSON.stringify(session({ scroll: many })));
    expect(Object.keys(trimmed?.scroll ?? {})).toHaveLength(0);
  });

  it("sanitizes out-of-range indices and scroll values", () => {
    const parsed = parseSession(
      JSON.stringify({
        ...session(),
        active: 99,
        tabs: [{ ...tab("o2", false, ["o1", "o2", "o3"]), historyIndex: 99 }, tab("o3")],
        scroll: { o2: -4, o3: "x" },
      }),
    );
    expect(parsed?.active).toBeNull();
    expect(parsed?.tabs[0]?.historyIndex).toBe(2);
    expect(parsed?.scroll).toEqual({});
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
    const r = restoreSession(session({ active: 2 }), [obj(1), obj(3, true)]);
    expect(r.tabs.map((t) => t.object?.id)).toEqual(["o1"]);
    expect(r.active).toBe(0);
    expect(r.tabs[0]?.history.map((h) => h.id)).toEqual(["o1"]);
    expect(r.tabs[0]?.historyIndex).toBe(0);
  });

  it("keeps each tab's own history and drops dead entries", () => {
    const r = restoreSession(session(), [obj(1), obj(2)]);
    expect(r.tabs[1]?.history.map((h) => h.id)).toEqual(["o1", "o2"]);
    expect(r.tabs[1]?.historyIndex).toBe(1);
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
    vi.mocked(events.objectChanged.listen).mockReset();
    vi.mocked(events.objectChanged.listen).mockResolvedValue(() => {});
  });

  it("restores the saved session on relaunch and skips pages that no longer exist", async () => {
    saveSession("Acme", session());
    vi.mocked(commands.objectList).mockResolvedValue({ status: "ok", data: [obj(1), obj(2)] });
    render(<Harness vault="Acme" />);
    await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(2));
    expect(screen.getByTestId("sel").getAttribute("data-val")).toBe("o2");
    expect(screen.getByRole("button", { name: "Desfijar pestaña" })).toBeTruthy();
    expect((screen.getByRole("button", { name: "Atrás" }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it("restores a v1 session without error", async () => {
    window.localStorage.setItem(
      "fossil.tabs.session:Acme",
      JSON.stringify({
        v: 1,
        tabs: [{ objectId: "o1", pinned: false }],
        active: 0,
        history: ["o1"],
        historyIndex: 0,
        scroll: {},
      }),
    );
    vi.mocked(commands.objectList).mockResolvedValue({ status: "ok", data: [obj(1)] });
    render(<Harness vault="Acme" />);
    await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(1));
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

  it("retries restoring on the next object:changed after object_list failed", async () => {
    saveSession("Acme", session());
    let fire: () => void = () => {};
    vi.mocked(events.objectChanged.listen).mockImplementation((cb) => {
      fire = () => (cb as () => void)();
      return Promise.resolve(() => {});
    });
    vi.mocked(commands.objectList)
      .mockResolvedValueOnce({ status: "error", error: { Storage: "x" } } as never)
      .mockResolvedValue({ status: "ok", data: [obj(1), obj(2)] });
    render(<Harness vault="Acme" />);
    await act(async () => {});
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
    expect(loadSession("Acme")).toEqual(session());
    await act(async () => fire());
    await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(2));
  });

  it("persists scroll offsets with a debounce, only for live pages", async () => {
    vi.useFakeTimers();
    saveSession("Acme", session());
    vi.mocked(commands.objectList).mockResolvedValue({ status: "ok", data: [obj(1), obj(2)] });
    render(<Harness vault="Acme" />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(screen.getAllByRole("tab")).toHaveLength(2);
    act(() => {
      recordScroll("o2", 777);
      recordScroll("ghost", 5);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(loadSession("Acme")?.scroll.o2).toBe(777);
    expect(loadSession("Acme")?.scroll.ghost).toBeUndefined();
    setScrollOffsets({});
  });
});
