import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AiEvent, ObjectMeta } from "./bindings";
import { commands, events } from "./bindings";
import { PageEditor } from "./page-editor";
import "./i18n";

vi.mock("./page-body", () => ({ PageBody: () => null }));
vi.mock("./bindings", () => ({
  commands: {
    objectList: vi.fn(),
    objectUpdateMeta: vi.fn(),
    linksBacklinks: vi.fn(),
    linksUnlinkedMentions: vi.fn(),
    aiChat: vi.fn(),
    aiCancel: vi.fn(),
  },
  events: {
    objectChanged: { listen: vi.fn() },
    indexUpdated: { listen: vi.fn() },
    aiEvent: { listen: vi.fn() },
  },
}));

afterEach(cleanup);

const base = {
  types: ["Page" as const],
  icon: null,
  parent: null,
  created_at: "",
  updated_at: "",
  archived: false,
};
const pageA: ObjectMeta = { ...base, id: "obj-a", title: "Campaña de otoño" };
const pageB: ObjectMeta = { ...base, id: "obj-b", title: "Presupuesto trimestral" };

describe("AiChatPanel (#14)", () => {
  let emitAi: ((payload: AiEvent) => void) | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    emitAi = undefined;
    vi.mocked(commands.objectList).mockResolvedValue({ status: "ok", data: [pageA, pageB] });
    vi.mocked(commands.linksBacklinks).mockResolvedValue({ status: "ok", data: [] });
    vi.mocked(commands.linksUnlinkedMentions).mockResolvedValue({ status: "ok", data: [] });
    vi.mocked(events.objectChanged.listen).mockResolvedValue(() => {});
    vi.mocked(events.indexUpdated.listen).mockResolvedValue(() => {});
    vi.mocked(events.aiEvent.listen).mockImplementation((cb) => {
      emitAi = (payload) => cb({ event: "ai:event", id: 1, payload });
      return Promise.resolve(() => {});
    });
  });

  it("attaches page/selection/@pages, previews outgoing context, streams chat and runs selection actions", async () => {
    vi.mocked(commands.aiChat).mockResolvedValue({ status: "ok", data: "req-1" });
    render(<PageEditor object={pageA} />);
    fireEvent.click(screen.getByRole("button", { name: "IA" }));
    expect(screen.getByRole("complementary", { name: "Panel de IA" })).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "@página" }));
    fireEvent.click(await screen.findByRole("button", { name: "@Presupuesto trimestral" }));
    const selBox = screen.getByRole("textbox", { name: "Acciones sobre la selección" });
    fireEvent.change(selBox, { target: { value: "Texto clave" } });
    const msgBox = screen.getByRole("textbox", { name: "Mensaje para la IA" });
    fireEvent.change(msgBox, { target: { value: "Analiza este plan" } });

    fireEvent.click(screen.getByRole("button", { name: "Vista previa del contexto" }));
    const preview = screen.getByTestId("ai-context-preview").textContent ?? "";
    expect(preview).toBe(
      "[Page] Campaña de otoño\n[@Page] Presupuesto trimestral\n[Selection] Texto clave\n[Prompt] Analiza este plan",
    );

    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
    await vi.waitFor(() => expect(commands.aiChat).toHaveBeenCalledTimes(1));
    expect(vi.mocked(commands.aiChat).mock.calls[0]?.[0]).toEqual({
      prompt: "Analiza este plan",
      context: [
        { Page: { object_id: "obj-a" } },
        { Object: { object_id: "obj-b" } },
        { Selection: { text: "Texto clave" } },
      ],
      options: { provider: null, model: null, timeout_ms: null },
    });

    await act(async () => {
      emitAi?.({ request_id: "req-1", event: { Started: { provider: "Agy", model: "g-2.5" } } });
      emitAi?.({ request_id: "req-1", event: { Delta: { text: "Resumen listo." } } });
    });
    expect(screen.getByText("Agy · g-2.5")).not.toBeNull();
    expect(screen.getByText("Resumen listo.")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(commands.aiCancel).toHaveBeenCalledWith("req-1");

    for (const label of ["Reescribir", "Resumir", "Traducir", "Cambiar tono"]) {
      fireEvent.click(screen.getByRole("button", { name: label }));
    }
    await vi.waitFor(() => expect(commands.aiChat).toHaveBeenCalledTimes(5));
    for (const [req] of vi.mocked(commands.aiChat).mock.calls.slice(1)) {
      expect(req.prompt).toContain("Texto clave");
      expect(req.context).toContainEqual({ Selection: { text: "Texto clave" } });
    }
  });
});
