import { type Editor, FossilEditor } from "@fossil/editor";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import type { AiEvent, ObjectMeta, Usage } from "./bindings";
import { commands, events } from "./bindings";
import { PageEditor } from "./page-editor";
import "./i18n";

let doc = new Y.Doc();
const emptyTransport = { load: async () => new Uint8Array(), apply: async () => {} };
vi.mock("./page-body", () => ({
  PageBody: () => <FossilEditor doc={doc} transport={emptyTransport} />,
}));
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
const usage: Usage = { input_tokens: 120, output_tokens: 15, cost_usd: 0.0012 };

describe("AiChatPanel (#14)", () => {
  let emitAi: ((payload: AiEvent) => void) | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    emitAi = undefined;
    doc = new Y.Doc();
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
    const ed = await vi.waitFor(() => {
      const e = (document.querySelector(".fossil-editor") as { editor?: Editor } | null)?.editor;
      expect(e).toBeDefined();
      return e as Editor;
    });
    act(() => {
      ed.commands.setContent(
        "<h2>Resumen con Texto clave</h2><p>Borrador inicial con Texto clave sin cambios.</p>",
      );
      const from = ed.state.doc.child(0).nodeSize + 1 + "Borrador inicial con ".length;
      ed.commands.setTextSelection({ from, to: from + "Texto clave".length });
    });

    fireEvent.click(screen.getByRole("button", { name: "IA" }));
    expect(screen.getByRole("complementary", { name: "Panel de IA" })).not.toBeNull();
    expect(screen.getByTestId("ai-chat-route").textContent).toBe("Agy · gemini-2.5-pro");
    expect(screen.getByTestId("ai-selection-route").textContent).toBe(
      "Anthropic · claude-sonnet-4-20250514",
    );
    fireEvent.click(screen.getByRole("button", { name: "@página" }));
    fireEvent.click(await screen.findByRole("button", { name: "@Presupuesto trimestral" }));
    const msgBox = screen.getByRole("textbox", { name: "Mensaje para la IA" });
    fireEvent.change(msgBox, { target: { value: "Analiza este plan" } });

    const preview = screen.getByTestId("ai-context-preview").textContent ?? "";
    expect(preview).toBe(
      "[Page] Campaña de otoño\n[@Page] Presupuesto trimestral\n[Selection] Texto clave\n[Prompt] Analiza este plan",
    );
    expect(screen.getByTestId("ai-estimated-usage").textContent).toContain("Estimado: ~27 tokens");

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
      emitAi?.({ request_id: "req-1", event: { Usage: usage } });
    });
    expect(screen.getByText("Agy · g-2.5")).not.toBeNull();
    expect(screen.getByText("Resumen listo.")).not.toBeNull();
    expect(screen.getByTestId("ai-actual-usage").textContent).toContain("$0.0012 USD");
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(commands.aiCancel).toHaveBeenCalledWith("req-1");

    vi.mocked(commands.aiChat).mockResolvedValueOnce({ status: "ok", data: "req-2" });
    fireEvent.click(screen.getByRole("button", { name: "Resumir" }));
    await vi.waitFor(() => expect(commands.aiChat).toHaveBeenCalledTimes(2));
    await act(async () => {
      emitAi?.({ request_id: "req-2", event: { Delta: { text: "Fuga sk-ant-" } } });
      emitAi?.({ request_id: "req-2", event: { Delta: { text: "api03-SECRET123456" } } });
      emitAi?.({
        request_id: "req-2",
        event: { Error: { message: "Fallo AIzaSECRET0123456789abcdefghij" } },
      });
    });
    expect(screen.queryByText(/SECRET/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Insertar en la página" })).toBeNull();

    const summary = {
      request_id: "req-3",
      provider: "Anthropic" as const,
      model: "claude-sonnet-4-20250514",
      usage,
      duration_ms: 10,
    };
    vi.mocked(commands.aiChat).mockResolvedValueOnce({ status: "ok", data: "req-3" });
    fireEvent.click(screen.getByRole("button", { name: "Reescribir" }));
    await vi.waitFor(() => expect(commands.aiChat).toHaveBeenCalledTimes(3));
    await act(async () => {
      emitAi?.({ request_id: "req-3", event: { Delta: { text: "Texto confirmado" } } });
      emitAi?.({ request_id: "req-3", event: { Done: { summary } } });
    });
    expect(ed.state.doc.child(1).textContent).toBe("Borrador inicial con Texto clave sin cambios.");
    fireEvent.click(screen.getByRole("button", { name: "Insertar en la página" }));
    expect(ed.state.doc.child(0).type.name).toBe("heading");
    expect(ed.state.doc.child(0).textContent).toBe("Resumen con Texto clave");
    expect(ed.state.doc.child(1).textContent).toBe(
      "Borrador inicial con Texto confirmado sin cambios.",
    );
  });
});
