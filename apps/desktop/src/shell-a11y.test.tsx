import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ObjectMeta, SearchHit } from "./bindings";
import i18n from "./i18n";
import { openPalette } from "./shell-palette";
import { PageFindBar, SEARCH_DEBOUNCE_MS, ShellSearch } from "./shell-search";
import { ShellSettings } from "./shell-settings";
import { ShellTabs, useWorkspaceTabs } from "./shell-tabs";
import { Sidebar } from "./sidebar";

const FOLDER: ObjectMeta = {
  id: "folder-1",
  types: [{ Builtin: "Folder" }],
  title: "Carpeta",
  icon: null,
  created_at: "2026-06-01T00:00:00Z",
  updated_at: "2026-06-01T00:00:00Z",
  archived: false,
  parent: null,
};
const CHILD: ObjectMeta = {
  id: "page-child",
  types: ["Page"],
  title: "Hija",
  icon: null,
  created_at: "2026-06-01T00:00:00Z",
  updated_at: "2026-06-01T00:00:00Z",
  archived: false,
  parent: "folder-1",
};
const ROOT_PAGE: ObjectMeta = {
  id: "page-root",
  types: ["Page"],
  title: "Raíz",
  icon: null,
  created_at: "2026-06-01T00:00:00Z",
  updated_at: "2026-06-01T00:00:00Z",
  archived: false,
  parent: null,
};

const HITS: SearchHit[] = [
  { object_id: "page-child", title: "Hija", types: ["Page"], snippet: [] },
  { object_id: "page-root", title: "Raíz", types: ["Page"], snippet: [] },
];

vi.mock("./bindings", () => ({
  commands: {
    objectList: vi.fn(async () => ({ status: "ok", data: [FOLDER, CHILD, ROOT_PAGE] })),
    searchQuery: vi.fn(async () => ({ status: "ok", data: HITS })),
    captureShortcutGet: vi.fn(async () => ({ status: "ok", data: "Win+Shift+F" })),
    captureShortcutSet: vi.fn(async (s: string) => ({ status: "ok", data: s })),
    appInfo: vi.fn(async () => ({ status: "ok", data: { version: "0.1.0", data_dir: "C:/data" } })),
  },
  events: {
    objectChanged: { listen: vi.fn(async () => () => {}) },
  },
}));

function TabsHarness() {
  const tabs = useWorkspaceTabs([], "Acme");
  return <ShellTabs {...tabs} onNewTab={() => tabs.openTab(FOLDER)} />;
}

describe("Shell keyboard navigation, visible focus tokens, and accessible labels (#139)", () => {
  beforeEach(async () => {
    window.localStorage.clear();
    await i18n.changeLanguage("es-MX");
  });
  afterEach(() => cleanup());

  it("defines token-based :focus-visible outline for all interactive controls in components.css", () => {
    const css = readFileSync(
      resolve(import.meta.dirname, "../../../packages/ui/styles/components.css"),
      "utf8",
    );
    expect(css).toContain(":focus-visible");
    expect(css).toContain("outline: 2px solid var(--accent)");
    expect(css).toContain('[role="tab"]');
    expect(css).toContain('[role="option"]');
  });

  it("navigates sidebar tree with ArrowDown/ArrowUp/ArrowLeft/ArrowRight and never leaves focus on body after closing dialogs", async () => {
    const onSelect = vi.fn();
    render(<Sidebar vaultName="Acme" selectedId={CHILD.id} onSelect={onSelect} />);
    const folderBtn = await screen.findByRole("button", { name: "Carpeta" });
    const childBtn = screen.getByRole("button", { name: "Hija" });
    const rootBtn = screen.getByRole("button", { name: "Raíz" });

    folderBtn.focus();
    fireEvent.keyDown(folderBtn, { key: "ArrowDown" });
    expect(document.activeElement).toBe(childBtn);
    fireEvent.keyDown(childBtn, { key: "ArrowDown" });
    expect(document.activeElement).toBe(rootBtn);
    fireEvent.keyDown(rootBtn, { key: "ArrowUp" });
    expect(document.activeElement).toBe(childBtn);

    fireEvent.keyDown(childBtn, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(folderBtn);
    fireEvent.keyDown(folderBtn, { key: "ArrowLeft" });
    expect(screen.queryByRole("button", { name: "Hija" })).toBeNull();
    fireEvent.keyDown(folderBtn, { key: "ArrowRight" });
    const childReopened = await screen.findByRole("button", { name: "Hija" });
    fireEvent.keyDown(folderBtn, { key: "ArrowRight" });
    expect(document.activeElement).toBe(childReopened);

    // Open palette when activeElement is body: closing must fall back to a control, never body.
    document.body.focus();
    openPalette("palette");
    const dialog = await screen.findByRole("dialog", { name: "Paleta de comandos" });
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(document.activeElement).not.toBe(document.body);
  });

  it("traps Tab, navigates filters and results with arrows in ShellSearch, and labels PageFindBar icon buttons", async () => {
    const onSelect = vi.fn();
    const hostRef = createRef<HTMLDivElement>();
    const { rerender } = render(
      <div ref={hostRef}>
        <button type="button">Disparador</button>
        <PageFindBar containerRef={hostRef} />
        <ShellSearch open={true} onClose={() => {}} onSelect={onSelect} />
      </div>,
    );

    await new Promise((r) => setTimeout(r, SEARCH_DEBOUNCE_MS + 30));
    const dialog = screen.getByRole("dialog", { name: "Búsqueda global" });
    const allFilter = screen.getByRole("button", { name: "Todos" });
    const pagesFilter = screen.getByRole("button", { name: "Páginas" });

    allFilter.focus();
    fireEvent.keyDown(allFilter, { key: "ArrowRight" });
    expect(document.activeElement).toBe(pagesFilter);
    expect(pagesFilter.getAttribute("aria-pressed")).toBe("true");

    await waitFor(() => expect(screen.getByRole("button", { name: /Hija/ })).toBeTruthy());
    fireEvent.keyDown(dialog, { key: "ArrowDown" });
    expect(document.activeElement?.textContent).toContain("Hija");
    fireEvent.keyDown(dialog, { key: "ArrowDown" });
    expect(document.activeElement?.textContent).toContain("Raíz");

    // Closing when opened from body falls back to a control and never stays on body.
    rerender(
      <div ref={hostRef}>
        <button type="button">Disparador</button>
        <PageFindBar containerRef={hostRef} />
        <ShellSearch open={false} onClose={() => {}} onSelect={onSelect} />
      </div>,
    );
    expect(document.activeElement).not.toBe(document.body);

    fireEvent.keyDown(window, { key: "f", ctrlKey: true });
    expect(await screen.findByRole("button", { name: "Coincidencia anterior" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Coincidencia siguiente" })).toBeTruthy();
  });

  it("navigates ShellSettings option groups with ArrowRight/ArrowLeft and ShellTabs with translated icon labels", () => {
    const { rerender } = render(
      <div>
        <TabsHarness />
        <ShellSettings open={true} vaultName="Acme" onClose={() => {}} />
      </div>,
    );

    const lightBtn = screen.getByRole("button", { name: "Claro" });
    const darkBtn = screen.getByRole("button", { name: "Oscuro" });
    lightBtn.focus();
    fireEvent.keyDown(lightBtn, { key: "ArrowRight" });
    expect(document.activeElement).toBe(darkBtn);
    expect(darkBtn.getAttribute("aria-pressed")).toBe("true");

    rerender(
      <div>
        <TabsHarness />
        <ShellSettings open={false} vaultName="Acme" onClose={() => {}} />
      </div>,
    );
    expect(document.activeElement).not.toBe(document.body);

    expect(screen.getByRole("button", { name: "Atrás" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Adelante" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Nueva pestaña" })).toBeTruthy();
  });
});
