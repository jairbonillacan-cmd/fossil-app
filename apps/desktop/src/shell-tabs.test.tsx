import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { ObjectMeta } from "./bindings";
import { ShellTabs, useWorkspaceTabs, type WorkspaceTab } from "./shell-tabs";
import "./i18n";

afterEach(cleanup);

const baseObj = JSON.parse(
  '{"types":["Page"],"icon":null,"parent":null,"created_at":"","updated_at":"","archived":false}',
) as Omit<ObjectMeta, "id" | "title">;
const withHistory = (object: ObjectMeta) => ({ object, history: [object], historyIndex: 0 });
const makeTabs = (n: number): WorkspaceTab[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `t${i + 1}`,
    pinned: false,
    ...withHistory({ ...baseObj, id: `obj-${i + 1}`, title: `Página ${i + 1}` }),
  }));

function Harness({ count }: { count: number }) {
  const t = useWorkspaceTabs(makeTabs(count));
  return (
    <div data-testid="sel" data-val={t.selectedObject?.id ?? "none"}>
      <ShellTabs {...t} />
    </div>
  );
}

describe("ShellTabs (#106)", () => {
  it("pins, closes, reorders by drag/keyboard/Ctrl+Tab, scrolls 15+ tabs, and steps history", () => {
    const { container, unmount } = render(<Harness count={3} />);
    fireEvent.click(screen.getAllByRole("button", { name: "Fijar pestaña" })[0] as HTMLElement);
    const unpinBtn = screen.getByRole("button", { name: "Desfijar pestaña" });
    expect(unpinBtn.closest("[data-tab-id='t1']")?.getAttribute("data-pinned")).toBe("true");
    fireEvent.keyDown(window, { key: "w", ctrlKey: true });
    expect(screen.getAllByRole("tab")).toHaveLength(3);
    const items = container.querySelectorAll("[data-tab-id]");
    fireEvent.dragStart(items[0] as Element);
    fireEvent.dragOver(items[2] as Element);
    expect(items[2]?.getAttribute("data-drop-target")).toBe("true");
    fireEvent.drop(items[2] as Element);
    fireEvent.keyDown(screen.getByRole("tab", { name: "Página 1" }), {
      key: "ArrowLeft",
      ctrlKey: true,
      shiftKey: true,
    });
    expect(screen.getAllByRole("tab")[1]?.getAttribute("aria-label")).toBe("Página 1");
    fireEvent.keyDown(window, { key: "Tab", ctrlKey: true });
    expect(screen.getByTestId("sel").getAttribute("data-val")).toBe("obj-3");
    fireEvent.click(unpinBtn);
    fireEvent.click(screen.getByRole("tab", { name: "Página 1" }));
    fireEvent.keyDown(window, { key: "w", ctrlKey: true });
    expect(screen.getAllByRole("tab")).toHaveLength(2);
    unmount();
    render(<Harness count={15} />);
    expect(screen.getByRole("tablist").className).toContain("overflow-x-auto");
    fireEvent.click(screen.getByRole("button", { name: "Nueva pestaña" }));
    expect(screen.getAllByRole("tab")).toHaveLength(16);
  });

  it("styles unpinned pin button with muted fg and hover fg without opacity reduction (#174)", () => {
    render(<Harness count={2} />);
    const pinBtns = screen.getAllByRole("button", { name: "Fijar pestaña" });
    const firstPin = pinBtns[0] as HTMLElement;
    expect(firstPin.className).toContain("text-[color:var(--fg-muted)]");
    expect(firstPin.className).toContain("hover:text-[color:var(--fg)]");
    expect(firstPin.className).not.toContain("opacity-70");

    fireEvent.click(firstPin);
    const unpinBtn = screen.getByRole("button", { name: "Desfijar pestaña" });
    expect(unpinBtn.className).toContain("font-bold");
    expect(unpinBtn.className).toContain("text-[color:var(--fg)]");
    expect(unpinBtn.className).not.toContain("text-[color:var(--fg-muted)]");
  });

  it("keeps an independent Back/Forward history per tab (#173)", () => {
    const [a, b, c] = ["a", "b", "c"].map((id) => ({ ...baseObj, id, title: `P-${id}` })) as [
      ObjectMeta,
      ObjectMeta,
      ObjectMeta,
    ];
    function H() {
      const t = useWorkspaceTabs([]);
      return (
        <div data-testid="sel" data-val={t.selectedObject?.id ?? "none"}>
          <button type="button" onClick={() => t.selectObject(a)}>
            open-a
          </button>
          <button type="button" onClick={() => t.selectObject(b)}>
            open-b
          </button>
          <button type="button" onClick={() => t.selectObject(c)}>
            open-c
          </button>
          <ShellTabs {...t} />
        </div>
      );
    }
    render(<H />);
    const sel = () => screen.getByTestId("sel").getAttribute("data-val");
    const back = () => screen.getByRole("button", { name: "Atrás" }) as HTMLButtonElement;
    const fwd = () => screen.getByRole("button", { name: "Adelante" }) as HTMLButtonElement;
    expect(back().disabled).toBe(true);
    fireEvent.click(screen.getByText("open-a"));
    fireEvent.click(screen.getByText("open-b"));
    expect(screen.getAllByRole("tab")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Nueva pestaña" }));
    expect(back().disabled).toBe(true);
    fireEvent.click(screen.getByText("open-c"));
    expect(sel()).toBe("c");
    expect(back().disabled).toBe(true);
    expect(fwd().disabled).toBe(true);
    fireEvent.click(screen.getAllByRole("tab")[0] as HTMLElement);
    expect(sel()).toBe("b");
    fireEvent.click(back());
    expect(sel()).toBe("a");
    expect(fwd().disabled).toBe(false);
    fireEvent.click(screen.getAllByRole("tab")[1] as HTMLElement);
    expect(sel()).toBe("c");
    expect(back().disabled).toBe(true);
    fireEvent.click(screen.getAllByRole("tab")[0] as HTMLElement);
    fireEvent.click(fwd());
    expect(sel()).toBe("b");
  });
});
