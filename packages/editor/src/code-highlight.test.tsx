import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { CodeBlockLanguage } from "./code-block";
import { codeHighlightKey } from "./code-highlight";
import { getBodyFragment } from "./editor";
import { YSync } from "./y-sync";

const loads = vi.hoisted(() => ({ engine: 0 }));
vi.mock("./code-highlighter", async (orig) => {
  loads.engine += 1;
  return orig();
});

const editors: Editor[] = [];
afterEach(() => {
  while (editors.length > 0) editors.pop()?.destroy();
});

describe("lazy highlighter (#144)", () => {
  it("is not imported while the page has no code block, and is once one appears", async () => {
    const ed = new Editor({
      element: document.body.appendChild(document.createElement("div")),
      extensions: [
        StarterKit.configure({ undoRedo: false, codeBlock: false }),
        CodeBlockLanguage,
        YSync(getBodyFragment(new Y.Doc())),
      ],
    });
    editors.push(ed);
    ed.commands.setContent("<p>hola</p>");
    await new Promise((r) => setTimeout(r, 50));
    expect(codeHighlightKey.getState(ed.state)?.hasCode).toBe(false);
    expect(loads.engine).toBe(0);

    ed.commands.setContent('<pre><code class="language-sql">select 1</code></pre>');
    await vi.waitFor(() => expect(loads.engine).toBe(1), { timeout: 15_000 });
    await vi.waitFor(
      () => expect(ed.view.dom.querySelector(".fossil-tok-keyword")).not.toBeNull(),
      {
        timeout: 15_000,
      },
    );
  });
});
