import { render, waitFor } from "@testing-library/react";
import type { Editor } from "@tiptap/core";
import { describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { FossilEditor, getBodyFragment } from "./editor";
import { fileNameForImage, isValidAttachmentPath, mimeTypeForAttachment } from "./image-attachment";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02]);
const BAD_PATHS = [
  "attachments/../.fossil/fossil.db|attachments\\..\\.fossil\\fossil.db|.fossil/fossil.db",
  "attachments/|attachments/sub/a.png|attachments/.hidden.png|attachments/a..png",
  "attachments/notes.txt|https://example.com/a.png|C:/Windows/win.ini",
]
  .join("|")
  .split("|");

describe("image-attachment (#5)", () => {
  it("validates attachment paths and normalizes clipboard filenames", () => {
    expect(isValidAttachmentPath("attachments/01J8.png")).toBe(true);
    expect(isValidAttachmentPath("attachments/01J8_a-b.WEBP")).toBe(true);
    expect(mimeTypeForAttachment("attachments/01J8.png")).toBe("image/png");
    expect(mimeTypeForAttachment("attachments/01J8.jpg")).toBe("image/jpeg");
    for (const bad of BAD_PATHS) {
      expect(isValidAttachmentPath(bad), bad).toBe(false);
      expect(mimeTypeForAttachment(bad), bad).toBeNull();
    }
    expect(fileNameForImage(new File([PNG], "a.PNG", { type: "image/png" }))).toBe("a.PNG");
    expect(fileNameForImage(new File([PNG], "", { type: "image/webp" }))).toBe("image.webp");
  });

  it("saves pasted and dropped images to attachments/, renders on reopen, and blocks outside paths", async () => {
    const vault = new Map<string, Uint8Array>();
    const saveAttachment = vi.fn(async (name: string, bytes: Uint8Array) => {
      const path = `attachments/01J8_${vault.size}.${name.slice(name.lastIndexOf(".") + 1).toLowerCase()}`;
      vault.set(path, bytes);
      return path;
    });
    const loadAttachment = vi.fn(async (path: string) => vault.get(path) ?? PNG);
    const doc = new Y.Doc();
    const holder: { instance: Editor | null } = { instance: null };
    const baseTransport = { load: async () => new Uint8Array(), apply: async () => {} };
    const first = render(
      <FossilEditor
        doc={doc}
        transport={{ ...baseTransport, saveAttachment, loadAttachment }}
        onReady={(e) => {
          holder.instance = e;
        }}
      />,
    );
    await waitFor(() => expect(holder.instance).not.toBeNull());

    const sendFile = (type: "paste" | "drop", name: string) => {
      const ev = new Event(type, { bubbles: true, cancelable: true });
      const files = [new File([PNG], name, { type: "image/png" })];
      Object.defineProperty(ev, type === "paste" ? "clipboardData" : "dataTransfer", {
        value: { files, items: [] },
      });
      holder.instance?.view.dom.dispatchEvent(ev);
    };
    sendFile("paste", "Esquema Acme.png");
    await waitFor(() => expect(saveAttachment).toHaveBeenCalledWith("Esquema Acme.png", PNG));
    sendFile("drop", "portada.png");
    await waitFor(() => expect(saveAttachment).toHaveBeenCalledWith("portada.png", PNG));
    await waitFor(() =>
      expect(first.container.querySelectorAll('figure[data-state="ready"]').length).toBe(2),
    );

    const xml = getBodyFragment(doc).toString();
    expect(xml).toContain('src="attachments/01J8_0.png"');
    expect(xml).not.toContain("data:image/png");
    const persisted = Y.encodeStateAsUpdate(doc);
    first.unmount();

    loadAttachment.mockClear();
    const reopened = render(
      <FossilEditor
        doc={new Y.Doc()}
        transport={{ ...baseTransport, load: async () => persisted, loadAttachment }}
      />,
    );
    await waitFor(() => expect(loadAttachment).toHaveBeenCalledWith("attachments/01J8_0.png"));
    await waitFor(() =>
      expect(reopened.container.querySelector("img")?.getAttribute("src")).toMatch(
        /^data:image\/png;base64,/,
      ),
    );
    reopened.unmount();

    loadAttachment.mockClear();
    const badDoc = new Y.Doc();
    const badImg = new Y.XmlElement("image");
    badImg.setAttribute("src", "attachments/../.fossil/fossil.db");
    getBodyFragment(badDoc).insert(0, [badImg]);
    const badState = Y.encodeStateAsUpdate(badDoc);
    const bad = render(
      <FossilEditor
        doc={new Y.Doc()}
        transport={{ ...baseTransport, load: async () => badState, loadAttachment }}
      />,
    );
    await waitFor(() =>
      expect(bad.container.querySelector("figure")?.getAttribute("data-state")).toBe("error"),
    );
    expect(loadAttachment).not.toHaveBeenCalled();
  });
});
