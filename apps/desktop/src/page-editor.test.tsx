import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ObjectMeta } from "./bindings";
import { commands, events } from "./bindings";
import { PageEditor } from "./page-editor";
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
  screen.getByRole("textbox", { name: "Título de la página" }) as HTMLInputElement;

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
      expect(screen.getByRole("button", { name: "Exportar Markdown" })).not.toBeNull();
      const toggle = screen.getByRole("button", { name: "Enlazada desde" });
      expect(toggle.getAttribute("aria-expanded")).toBe("true");
      expect(await screen.findByRole("complementary", { name: "Enlazada desde" })).not.toBeNull();
      await awaitEditor(container);
      expect(commands.objectLoadDoc).toHaveBeenCalledWith("obj-1");
      expect(commands.objectApplyUpdate).not.toHaveBeenCalled();
      expect(commands.objectUpdateMeta).not.toHaveBeenCalled();
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
});
