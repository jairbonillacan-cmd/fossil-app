import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import type { ObjectMeta } from "./bindings";
import { commands, events } from "./bindings";
import { PageEditor } from "./page-editor";
import { ShellTabs, useWorkspaceTabs } from "./shell-tabs";
import "./i18n";

// Commands are mocked like in page-body.test.tsx; the editor itself is real,
// so the transport flow (load/apply) runs against the mocked IPC.
vi.mock("./bindings", () => ({
  commands: {
    objectUpdateMeta: vi.fn(),
    objectLoadDoc: vi.fn(),
    objectApplyUpdate: vi.fn(),
    objectList: vi.fn(),
    linksBacklinks: vi.fn(),
    linksUnlinkedMentions: vi.fn(),
  },
  events: {
    objectChanged: { listen: vi.fn() },
    indexUpdated: { listen: vi.fn() },
  },
}));

// TipTap + Yjs import cost is high on a busy machine.
const SLOW = 20_000;

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
const second: ObjectMeta = { ...page, id: "obj-2", title: "Campaña Acme" };

const titleInput = () =>
  screen.getByRole("textbox", { name: "Título de la página" }) as HTMLTextAreaElement;

async function awaitEditor(container: HTMLElement) {
  await vi.waitFor(() => expect(container.querySelector(".fossil-editor")).not.toBeNull(), {
    timeout: SLOW,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(commands.objectLoadDoc).mockResolvedValue({ status: "ok", data: [0, 0] });
  vi.mocked(commands.objectApplyUpdate).mockResolvedValue({ status: "ok", data: null });
  vi.mocked(commands.objectUpdateMeta).mockResolvedValue({ status: "ok", data: page });
  vi.mocked(commands.objectList).mockResolvedValue({ status: "ok", data: [page, second] });
  vi.mocked(commands.linksBacklinks).mockResolvedValue({ status: "ok", data: [] });
  vi.mocked(commands.linksUnlinkedMentions).mockResolvedValue({ status: "ok", data: [] });
  vi.mocked(events.objectChanged.listen).mockResolvedValue(() => {});
  vi.mocked(events.indexUpdated.listen).mockResolvedValue(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe("PageEditor", () => {
  it(
    "mounts the header and the block editor for the open page, writing nothing on open",
    async () => {
      const { container } = render(<PageEditor object={page} />);
      const input = titleInput();
      expect(input.value).toBe("Launch checklist");
      expect(input.getAttribute("placeholder")).toBe("Sin título");
      expect(screen.getByRole("button", { name: "Más acciones" })).not.toBeNull();
      expect(screen.queryByRole("menuitem", { name: "Exportar Markdown" })).toBeNull();
      const toggle = screen.getByRole("button", { name: "Enlazada desde" });
      expect(toggle.getAttribute("aria-expanded")).toBe("true");
      expect(
        await screen.findByRole("complementary", { name: "Enlazada desde" }, { timeout: SLOW }),
      ).not.toBeNull();
      await awaitEditor(container);
      expect(commands.objectLoadDoc).toHaveBeenCalledWith("obj-1");
      expect(commands.objectApplyUpdate).not.toHaveBeenCalled();
      expect(commands.objectUpdateMeta).not.toHaveBeenCalled();
    },
    SLOW,
  );

  it(
    "toggles the right panel with Ctrl+Alt+B and hides it in an unfocused split pane (#166)",
    async () => {
      const { unmount } = render(<PageEditor object={page} />);
      const toggle = screen.getByRole("button", { name: "Enlazada desde" });
      fireEvent.keyDown(window, { key: "b", ctrlKey: true, altKey: true });
      expect(toggle.getAttribute("aria-expanded")).toBe("false");
      fireEvent.keyDown(window, { key: "b", ctrlKey: true, altKey: true });
      expect(toggle.getAttribute("aria-expanded")).toBe("true");
      unmount();

      render(<PageEditor object={page} focused={false} />);
      fireEvent.keyDown(window, { key: "b", ctrlKey: true, altKey: true });
      expect(screen.queryByRole("complementary", { name: "Enlazada desde" })).toBeNull();
    },
    SLOW,
  );

  it(
    "shows the localized empty state when no page is open",
    () => {
      render(<PageEditor object={null} />);
      expect(
        screen.getByRole("heading", { level: 2, name: "Ninguna página abierta" }),
      ).not.toBeNull();
      expect(screen.getByText("Elige una página de la lista o crea una nueva.")).not.toBeNull();
      expect(screen.queryByRole("textbox")).toBeNull();
    },
    SLOW,
  );

  it(
    "commits the edited title once the 400 ms debounce elapses",
    async () => {
      const { container } = render(<PageEditor object={page} />);
      await awaitEditor(container);
      vi.useFakeTimers();
      fireEvent.change(titleInput(), { target: { value: "Roadmap Q4" } });
      vi.advanceTimersByTime(399);
      expect(commands.objectUpdateMeta).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(commands.objectUpdateMeta).toHaveBeenCalledTimes(1);
      expect(commands.objectUpdateMeta).toHaveBeenCalledWith("obj-1", {
        title: "Roadmap Q4",
        icon: null,
        types: null,
        archived: null,
      });
    },
    SLOW,
  );

  it(
    "flushes the pending title on blur when switching pages and loads the new body",
    async () => {
      const { container, rerender } = render(<PageEditor object={page} />);
      await awaitEditor(container);
      const input = titleInput();
      fireEvent.change(input, { target: { value: "Roadmap Q4" } });
      // Clicking another page in the sidebar moves focus out of the title
      // input first: the pending edit is flushed before the object changes.
      fireEvent.blur(input);
      expect(commands.objectUpdateMeta).toHaveBeenCalledTimes(1);
      expect(commands.objectUpdateMeta).toHaveBeenCalledWith("obj-1", {
        title: "Roadmap Q4",
        icon: null,
        types: null,
        archived: null,
      });

      rerender(<PageEditor object={second} />);
      expect(titleInput().value).toBe("Campaña Acme");
      await vi.waitFor(() => expect(commands.objectLoadDoc).toHaveBeenLastCalledWith("obj-2"), {
        timeout: SLOW,
      });
      // The old page is not saved again while switching.
      expect(commands.objectUpdateMeta).toHaveBeenCalledTimes(1);
    },
    SLOW,
  );

  it(
    "keeps the title editable and saved when the body transport fails (localized alert, no text lost)",
    async () => {
      vi.mocked(commands.objectLoadDoc).mockResolvedValue({
        status: "error",
        error: "NotImplemented",
      });
      render(<PageEditor object={page} />);
      const alert = await screen.findByRole("alert", {}, { timeout: SLOW });
      expect(alert).not.toBeNull();
      expect(alert.textContent).toBe("Esta función todavía no está disponible.");
      // The header survives the failed body load: the title is still there
      // and an edit still reaches object_update_meta.
      const input = titleInput();
      expect(input.value).toBe("Launch checklist");
      fireEvent.change(input, { target: { value: "Roadmap Q4" } });
      fireEvent.blur(input);
      expect(commands.objectUpdateMeta).toHaveBeenCalledWith("obj-1", {
        title: "Roadmap Q4",
        icon: null,
        types: null,
        archived: null,
      });
    },
    SLOW,
  );

  it(
    "saves again when renaming A -> B -> A and avoids duplicate saves between debounce and blur (#51)",
    async () => {
      const onObjectUpdated = vi.fn();
      vi.mocked(commands.objectUpdateMeta).mockImplementation(async (id, patch) => ({
        status: "ok",
        data: { ...page, id, title: patch.title ?? page.title },
      }));
      const { container } = render(<PageEditor object={page} onObjectUpdated={onObjectUpdated} />);
      await awaitEditor(container);
      vi.useFakeTimers();

      const input = titleInput();
      fireEvent.change(input, { target: { value: "Nuevo" } });
      vi.advanceTimersByTime(400);
      fireEvent.blur(input);
      expect(commands.objectUpdateMeta).toHaveBeenCalledTimes(1);
      expect(commands.objectUpdateMeta).toHaveBeenLastCalledWith("obj-1", {
        title: "Nuevo",
        icon: null,
        types: null,
        archived: null,
      });

      fireEvent.change(input, { target: { value: "Launch checklist" } });
      vi.advanceTimersByTime(400);
      expect(commands.objectUpdateMeta).toHaveBeenCalledTimes(2);
      expect(commands.objectUpdateMeta).toHaveBeenLastCalledWith("obj-1", {
        title: "Launch checklist",
        icon: null,
        types: null,
        archived: null,
      });
      await vi.waitFor(() =>
        expect(onObjectUpdated).toHaveBeenLastCalledWith({
          ...page,
          title: "Launch checklist",
        }),
      );
    },
    SLOW,
  );

  it("displays a 120-character title in full with multiline wrap and tooltip (#105)", () => {
    const longTitle =
      "Estrategia integral de lanzamiento para la campaña trimestral de Mi equipo en canales orgánicos, tienda y anuncios 2026";
    expect(longTitle).toHaveLength(119);
    const title120 = `${longTitle}!`;
    expect(title120).toHaveLength(120);

    render(<PageEditor object={{ ...page, title: title120 }} />);
    const input = titleInput();
    expect(input.tagName).toBe("TEXTAREA");
    expect(input.value).toBe(title120);
    expect(input.getAttribute("title")).toBe(title120);
    expect(input.className).toContain("break-words");
  });

  it("opens the ⋯ actions menu with click, Enter and Space, and closes with Escape and outside click restoring focus (#105)", () => {
    render(<PageEditor object={page} />);
    const moreBtn = screen.getByRole("button", { name: "Más acciones" });
    expect(moreBtn.getAttribute("aria-expanded")).toBe("false");

    // Open with click, close with Escape -> focus returns to ⋯ button
    fireEvent.click(moreBtn);
    expect(moreBtn.getAttribute("aria-expanded")).toBe("true");
    const menu = screen.getByRole("menu", { name: "Más acciones" });
    expect(menu).not.toBeNull();
    const firstItem = screen.getByRole("menuitem", { name: "Exportar Markdown" });
    expect(document.activeElement).toBe(firstItem);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(moreBtn.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(moreBtn);

    // Open with Enter, close with outside click -> focus returns to ⋯ button
    fireEvent.keyDown(moreBtn, { key: "Enter" });
    expect(screen.getByRole("menu", { name: "Más acciones" })).not.toBeNull();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(moreBtn);

    // Open with Space (" ")
    fireEvent.keyDown(moreBtn, { key: " " });
    expect(screen.getByRole("menu", { name: "Más acciones" })).not.toBeNull();
  });

  it("navigates ⋯ menu actions with ArrowDown/ArrowUp and executes with Enter (#105)", () => {
    const printSpy = vi.spyOn(window, "print").mockImplementation(() => {});
    render(<PageEditor object={page} />);
    const moreBtn = screen.getByRole("button", { name: "Más acciones" });

    fireEvent.click(moreBtn);
    const items = screen.getAllByRole("menuitem");
    expect(items.map((el) => el.textContent)).toEqual([
      "Exportar Markdown",
      "Exportar PDF",
      "Copiar enlace",
    ]);
    const mdItem = screen.getByRole("menuitem", { name: "Exportar Markdown" });
    const pdfItem = screen.getByRole("menuitem", { name: "Exportar PDF" });
    const copyItem = screen.getByRole("menuitem", { name: "Copiar enlace" });
    expect(document.activeElement).toBe(mdItem);

    // ArrowDown moves focus to "Exportar PDF"
    fireEvent.keyDown(mdItem, { key: "ArrowDown" });
    expect(document.activeElement).toBe(pdfItem);

    // ArrowDown again moves to "Copiar enlace", ArrowUp moves back to "Exportar PDF"
    fireEvent.keyDown(pdfItem, { key: "ArrowDown" });
    expect(document.activeElement).toBe(copyItem);
    fireEvent.keyDown(copyItem, { key: "ArrowUp" });
    expect(document.activeElement).toBe(pdfItem);

    // Enter executes "Exportar PDF", closes the menu and restores focus to ⋯ button
    fireEvent.keyDown(pdfItem, { key: "Enter" });
    expect(printSpy).toHaveBeenCalledOnce();
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(moreBtn);
    printSpy.mockRestore();
  });

  it(
    "shows Guardado / Guardando… / Error al guardar with Reintentar and confirms before closing tab or window (#164)",
    async () => {
      let activeDoc: Y.Doc | null = null;
      const origGetXml = Y.Doc.prototype.getXmlFragment;
      const docSpy = vi.spyOn(Y.Doc.prototype, "getXmlFragment").mockImplementation(function (
        this: Y.Doc,
        name,
      ) {
        activeDoc = this;
        return origGetXml.call(this, name);
      });
      const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);

      function WorkspaceHarness() {
        const tabs = useWorkspaceTabs([
          { id: "t1", object: page, pinned: false, history: [page], historyIndex: 0 },
        ]);
        return (
          <div>
            <ShellTabs {...tabs} />
            <PageEditor object={tabs.selectedObject} />
          </div>
        );
      }

      const { container } = render(<WorkspaceHarness />);
      await awaitEditor(container);
      const statusEl = () => container.querySelector("output[data-save-status]") as HTMLElement;
      expect(statusEl().getAttribute("data-save-status")).toBe("Saved");
      expect(statusEl().textContent).toContain("Guardado");

      vi.mocked(commands.objectApplyUpdate).mockResolvedValueOnce({
        status: "error",
        error: { Storage: "disk full" },
      });

      act(() => {
        activeDoc?.getMap("draft").set("k1", "v1");
      });
      expect(statusEl().getAttribute("data-save-status")).toBe("Saving");
      expect(statusEl().textContent).toContain("Guardando…");

      // Closing window or tab while Saving asks for confirmation.
      const unloadSaving = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(unloadSaving);
      expect(unloadSaving.defaultPrevented).toBe(true);
      fireEvent.click(screen.getByRole("button", { name: "Cerrar pestaña" }));
      expect(confirmSpy).toHaveBeenCalledOnce();
      expect(screen.getAllByRole("tab")).toHaveLength(1);

      // After the 250 ms batch window fails, status locks to Error (never Saved).
      await vi.waitFor(() => expect(statusEl().getAttribute("data-save-status")).toBe("Error"), {
        timeout: SLOW,
      });
      expect(statusEl().getAttribute("data-failed-seq")).toBe("1");
      expect(statusEl().getAttribute("title")).toContain("disk full");
      expect(statusEl().textContent).toContain("Error al guardar");
      expect(statusEl().textContent).not.toContain("Guardado");

      // Closing tab with Ctrl+W while in Error also asks for confirmation.
      fireEvent.keyDown(window, { key: "w", ctrlKey: true });
      expect(confirmSpy).toHaveBeenCalledTimes(2);
      expect(screen.getAllByRole("tab")).toHaveLength(1);

      // Clicking Reintentar persists the queued update and transitions to Guardado.
      fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
      await vi.waitFor(() => expect(statusEl().getAttribute("data-save-status")).toBe("Saved"), {
        timeout: SLOW,
      });
      expect(statusEl().textContent).toContain("Guardado");
      expect(commands.objectApplyUpdate).toHaveBeenCalledTimes(2);

      docSpy.mockRestore();
      confirmSpy.mockRestore();
    },
    SLOW,
  );
});
