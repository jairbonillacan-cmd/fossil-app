import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { ObjectMeta } from "./bindings";
import { ShellTabs, useWorkspaceTabs, type WorkspaceTab } from "./shell-tabs";
import { parseSession, restoreSession, SESSION_VERSION } from "./tabs-session";
import "./i18n";

afterEach(cleanup);

const page = (id: string): ObjectMeta =>
  ({
    id,
    types: ["Page"],
    title: `Página ${id}`,
    icon: null,
    parent: null,
    created_at: "",
    updated_at: "",
    archived: false,
  }) as ObjectMeta;
const A = page("a");
const B = page("b");
const C = page("c");
const tab: WorkspaceTab = { id: "t1", object: A, pinned: false, history: [A], historyIndex: 0 };

let api: ReturnType<typeof useWorkspaceTabs>;
function Harness() {
  api = useWorkspaceTabs([tab]);
  return <ShellTabs {...api} />;
}

describe("Split panes (#166)", () => {
  it("opens a second pane with its own page and history, routed by focus", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Dividir a la derecha" }));
    expect(api.splitOpen).toBe(true);
    expect(api.splitObject?.id).toBe("a");
    expect(api.focusedPane).toBe("split");

    act(() => api.selectObject(B));
    expect(api.splitObject?.id).toBe("b");
    expect(api.selectedObject?.id).toBe("a");
    expect(api.canGoBack).toBe(true);

    act(() => api.onFocusPane("main"));
    expect(api.canGoBack).toBe(false);
    act(() => api.selectObject(C));
    expect(api.selectedObject?.id).toBe("c");
    expect(api.splitObject?.id).toBe("b");

    act(() => api.onFocusPane("split"));
    act(() => api.onGoBack());
    expect(api.splitObject?.id).toBe("a");
    expect(api.selectedObject?.id).toBe("c");
  });

  it("Ctrl+\\ splits; Ctrl+W in the split closes the pane, not a tab", () => {
    render(<Harness />);
    fireEvent.keyDown(window, { key: "\\", ctrlKey: true });
    expect(api.splitOpen).toBe(true);
    fireEvent.keyDown(window, { key: "w", ctrlKey: true });
    expect(api.splitOpen).toBe(false);
    expect(api.focusedPane).toBe("main");
    expect(api.tabs).toHaveLength(1);
  });

  it("saves the split pane in the session and drops it when its page is gone", () => {
    const saved = JSON.stringify({
      v: SESSION_VERSION,
      tabs: [{ objectId: "a", pinned: false, history: ["a"], historyIndex: 0 }],
      active: 0,
      split: { objectId: "b", pinned: false, history: ["a", "b"], historyIndex: 1 },
      scroll: { b: 120 },
    });
    const session = parseSession(saved);
    expect(session?.split?.objectId).toBe("b");
    expect(session?.scroll).toEqual({ b: 120 });

    const restored = session && restoreSession(session, [A, B]);
    expect(restored?.split?.object?.id).toBe("b");
    expect(restored?.split?.history.map((o) => o.id)).toEqual(["a", "b"]);
    expect(session && restoreSession(session, [A]).split).toBeNull();

    const corrupt = parseSession(saved.replace('"objectId":"b"', '"objectId":7'));
    expect(corrupt?.tabs).toHaveLength(1);
    expect(corrupt?.split).toBeUndefined();
  });
});
