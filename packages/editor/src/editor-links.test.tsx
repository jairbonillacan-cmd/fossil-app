import { render, waitFor } from "@testing-library/react";
import type { Editor } from "@tiptap/core";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { FossilEditor } from "./editor";
import type { DocTransport } from "./transport";

/** One paragraph per link, as a document coming from another vault would carry them. */
const linksUpdate = (links: { href: string; target?: string }[]): Uint8Array => {
  const doc = new Y.Doc();
  const fragment = doc.getXmlFragment("body");
  links.forEach((link, index) => {
    const block = new Y.XmlElement("paragraph");
    block.setAttribute("blockId", `blk_${index}`);
    const text = new Y.XmlText();
    text.insert(0, `link ${index}`, { link: { target: null, rel: null, ...link } });
    block.insert(0, [text]);
    fragment.insert(fragment.length, [block]);
  });
  return Y.encodeStateAsUpdate(doc);
};

const transport = (update: Uint8Array): DocTransport => ({
  load: async () => update,
  apply: async () => {},
});

const renderLinks = async (links: { href: string; target?: string }[]) => {
  const holder: { instance: Editor | null } = { instance: null };
  const view = render(
    <FossilEditor
      doc={new Y.Doc()}
      transport={transport(linksUpdate(links))}
      onReady={(instance) => {
        holder.instance = instance;
      }}
    />,
  );
  await waitFor(() => expect(view.container.querySelectorAll("a")).toHaveLength(links.length));
  return { anchors: [...view.container.querySelectorAll("a")], editor: holder.instance };
};

describe("editor links", () => {
  it("drops every href that is not http or https", async () => {
    const { anchors } = await renderLinks([
      { href: "file:///C:/Users/Acme/notas.txt" },
      { href: "\\\\server\\share\\doc" },
      { href: "//server/share" },
      { href: "javascript:alert(1)" },
      { href: "ms-settings:privacy" },
      { href: "https://acme.example/plan" },
    ]);
    const hrefs = anchors.map((anchor) => anchor.getAttribute("href"));
    expect(hrefs.slice(0, 5).every((href) => !href)).toBe(true);
    expect(hrefs[5]).toBe("https://acme.example/plan");
  });

  it("always renders links as new-window, no-referrer links", async () => {
    const { anchors } = await renderLinks([
      { href: "https://acme.example/a", target: "_self" },
      { href: "https://acme.example/b", target: "_top" },
    ]);
    for (const anchor of anchors) {
      expect(anchor.getAttribute("target")).toBe("_blank");
      expect(anchor.getAttribute("rel")).toContain("noopener");
    }
  });

  // jsdom cannot drive ProseMirror's click handling (no elementFromPoint), so
  // the option that turns the handler on is checked directly.
  it("never opens links on click from inside the editor", async () => {
    const { editor } = await renderLinks([{ href: "https://acme.example/a", target: "_self" }]);
    const link = editor?.extensionManager.extensions.find((extension) => extension.name === "link");
    expect(link?.options.openOnClick).toBe(false);
  });
});
