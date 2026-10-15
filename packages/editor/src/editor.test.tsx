import { render, screen, waitFor } from "@testing-library/react";
import type { Editor } from "@tiptap/core";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { FossilEditor } from "./editor";
import type { DocTransport } from "./transport";

/** Neutral body with two identified blocks, as stored by the object vault. */
const bodyUpdate = (): Uint8Array => {
  const doc = new Y.Doc();
  const fragment = doc.getXmlFragment("body");
  for (const [index, text] of ["First test block.", "Second test block."].entries()) {
    const block = new Y.XmlElement("paragraph");
    block.setAttribute("blockId", `blk_${index}`);
    const content = new Y.XmlText();
    content.insert(0, text);
    block.insert(0, [content]);
    fragment.insert(fragment.length, [block]);
  }
  return Y.encodeStateAsUpdate(doc);
};

const transportOf = (loadResult: Uint8Array, applied: Uint8Array[]): DocTransport => ({
  load: async () => loadResult,
  apply: async (update) => {
    applied.push(update);
  },
});

describe("FossilEditor", () => {
  it("renders the body returned by transport.load", async () => {
    render(<FossilEditor doc={new Y.Doc()} transport={transportOf(bodyUpdate(), [])} />);
    expect(await screen.findByText("First test block.")).toBeDefined();
    expect(screen.getByText("Second test block.")).toBeDefined();
  });

  it("shows the localized placeholder on an empty body", async () => {
    const { container } = render(
      <FossilEditor
        doc={new Y.Doc()}
        transport={transportOf(new Uint8Array(), [])}
        t={(key) => (key === "editor.placeholder" ? "Escribe aquí" : key)}
      />,
    );
    await waitFor(() =>
      expect(container.querySelector("p.is-empty")?.getAttribute("data-placeholder")).toBe(
        "Escribe aquí",
      ),
    );
  });

  it("never calls apply when opening an existing or empty body without interaction, even after flush", async () => {
    for (const initial of [bodyUpdate(), new Uint8Array()]) {
      const applied: Uint8Array[] = [];
      const holder: { instance: Editor | null } = { instance: null };
      const view = render(
        <FossilEditor
          doc={new Y.Doc()}
          transport={transportOf(initial, applied)}
          onReady={(instance) => {
            holder.instance = instance;
          }}
        />,
      );
      await waitFor(() => expect(holder.instance).not.toBeNull());
      view.unmount();
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(applied).toHaveLength(0);
    }
  });

  it("sends local edits to the transport batched into one update", async () => {
    const applied: Uint8Array[] = [];
    const holder: { instance: Editor | null } = { instance: null };
    render(
      <FossilEditor
        doc={new Y.Doc()}
        transport={transportOf(bodyUpdate(), applied)}
        onReady={(instance) => {
          holder.instance = instance;
        }}
      />,
    );
    await waitFor(() => expect(holder.instance).not.toBeNull());
    holder.instance?.commands.insertContent("Z");
    holder.instance?.commands.insertContent("W");
    await waitFor(() => expect(applied).toHaveLength(1), { timeout: 1500 });
  });

  it("calls onReady with a two-block editor instance", async () => {
    const holder: { instance: Editor | null } = { instance: null };
    render(
      <FossilEditor
        doc={new Y.Doc()}
        transport={transportOf(bodyUpdate(), [])}
        onReady={(instance) => {
          holder.instance = instance;
        }}
      />,
    );
    await waitFor(() => expect(holder.instance).not.toBeNull());
    expect(holder.instance?.state.doc.childCount).toBe(2);
  });
});
