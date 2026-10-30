import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { ObjectMeta } from "./bindings";
import { ShellTabs, useWorkspaceTabs, type WorkspaceTab } from "./shell-tabs";
import "./i18n";

afterEach(cleanup);

const tabOf = (i: number): WorkspaceTab => {
  const object = { id: `p${i}`, title: `Página ${i}`, types: ["Page"] } as ObjectMeta;
  return { id: `t${i}`, object, pinned: false, history: [object], historyIndex: 0 };
};

let api: ReturnType<typeof useWorkspaceTabs>;
function Harness() {
  api = useWorkspaceTabs([1, 2, 3, 4].map(tabOf));
  return <ShellTabs {...api} />;
}

describe("Tab shortcuts", () => {
  it("Ctrl+1..8 jumps to a tab and Ctrl+9 to the last one", () => {
    render(<Harness />);
    fireEvent.keyDown(window, { key: "3", ctrlKey: true });
    expect(api.activeTabId).toBe("t3");
    fireEvent.keyDown(window, { key: "9", ctrlKey: true });
    expect(api.activeTabId).toBe("t4");
    fireEvent.keyDown(window, { key: "8", ctrlKey: true });
    expect(api.activeTabId).toBe("t4");
  });

  it("Ctrl+Shift+T reopens closed tabs in place with their history, newest first", () => {
    render(<Harness />);
    act(() => api.onCloseTab("t2"));
    act(() => api.onCloseTab("t4"));
    expect(api.tabs.map((t) => t.object?.id)).toEqual(["p1", "p3"]);
    fireEvent.keyDown(window, { key: "T", ctrlKey: true, shiftKey: true });
    expect(api.tabs.map((t) => t.object?.id)).toEqual(["p1", "p3", "p4"]);
    fireEvent.keyDown(window, { key: "T", ctrlKey: true, shiftKey: true });
    expect(api.tabs.map((t) => t.object?.id)).toEqual(["p1", "p2", "p3", "p4"]);
    expect(api.selectedObject?.id).toBe("p2");
    expect(new Set(api.tabs.map((t) => t.id)).size).toBe(4);
    fireEvent.keyDown(window, { key: "T", ctrlKey: true, shiftKey: true });
    expect(api.tabs).toHaveLength(4);
  });

  it("reopens a closed tab with metadata renamed while it was closed", () => {
    render(<Harness />);
    act(() => api.onCloseTab("t2"));
    act(() => api.updateObject({ ...(tabOf(2).object as ObjectMeta), title: "Página renombrada" }));
    fireEvent.keyDown(window, { key: "T", ctrlKey: true, shiftKey: true });
    expect(api.selectedObject?.title).toBe("Página renombrada");
    expect(api.tabs[1]?.history[0]?.title).toBe("Página renombrada");
  });
});
