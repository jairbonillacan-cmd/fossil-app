import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getEditor } from "./ai-panel";
import type { ObjectMeta } from "./bindings";
import { commands, events } from "./bindings";
import { PageEditor } from "./page-editor";
import "./i18n";

vi.mock("./page-body", () => ({ PageBody: () => <div data-testid="page-body" /> }));
vi.mock("./ai-panel", async (orig) => ({
  ...(await orig<typeof import("./ai-panel")>()),
  AiChatPanel: () => {
    const [draft, setDraft] = useState("");
    return <input aria-label="borrador" value={draft} onChange={(e) => setDraft(e.target.value)} />;
  },
}));
vi.mock("./bindings", () => ({
  commands: {
    objectUpdateMeta: vi.fn(),
    objectList: vi.fn(),
    linksBacklinks: vi.fn(),
    linksUnlinkedMentions: vi.fn(),
  },
  events: { objectChanged: { listen: vi.fn() }, indexUpdated: { listen: vi.fn() } },
}));

afterEach(cleanup);
beforeEach(() => {
  vi.mocked(commands.objectList).mockResolvedValue({ status: "ok", data: [] });
  vi.mocked(commands.linksBacklinks).mockResolvedValue({ status: "ok", data: [] });
  vi.mocked(commands.linksUnlinkedMentions).mockResolvedValue({ status: "ok", data: [] });
  vi.mocked(events.objectChanged.listen).mockResolvedValue(() => {});
  vi.mocked(events.indexUpdated.listen).mockResolvedValue(() => {});
});

const page = { id: "p1", types: ["Page"], title: "Plan", icon: null, parent: null } as ObjectMeta;

describe("AI panel in split panes (#166)", () => {
  it("keeps the chat mounted, only hidden, when the pane loses focus", () => {
    const { rerender } = render(<PageEditor object={page} />);
    fireEvent.click(screen.getByRole("button", { name: "IA" }));
    fireEvent.change(screen.getByLabelText("borrador"), { target: { value: "resume esto" } });
    rerender(<PageEditor object={page} focused={false} />);
    const input = screen.getByLabelText("borrador") as HTMLInputElement;
    expect(input.closest(".hidden")).not.toBeNull();
    rerender(<PageEditor object={page} focused />);
    expect((screen.getByLabelText("borrador") as HTMLInputElement).value).toBe("resume esto");
  });

  it("reads the editor of its own pane", () => {
    document.body.innerHTML = `
      <section data-pane="main"><div class="fossil-editor" id="e1"></div></section>
      <section data-pane="split"><div class="fossil-editor" id="e2"></div><aside id="ai"></aside></section>`;
    const marker = {} as never;
    Object.assign(document.getElementById("e2") as object, { editor: marker });
    expect(getEditor(document.getElementById("ai"))).toBe(marker);
    document.body.innerHTML = "";
  });
});
