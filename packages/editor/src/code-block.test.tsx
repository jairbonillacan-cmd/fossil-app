import { Editor } from "@tiptap/core";
import { Slice } from "@tiptap/pm/model";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import { BlockId } from "./block-id";
import { CodeBlockLanguage } from "./code-block";
import { detectLanguage, normalizeLanguage } from "./code-languages";
import { getBodyFragment } from "./editor";
import { YSync } from "./y-sync";

const editors: Editor[] = [];
const makeEditor = (doc: Y.Doc, content?: string): Editor => {
  const el = document.createElement("div");
  document.body.append(el);
  const ed = new Editor({
    element: el,
    extensions: [
      StarterKit.configure({ undoRedo: false, codeBlock: false }),
      CodeBlockLanguage,
      BlockId,
      YSync(getBodyFragment(doc)),
    ],
  });
  editors.push(ed);
  if (content !== undefined) ed.commands.setContent(content);
  return ed;
};
afterEach(() => {
  while (editors.length > 0) editors.pop()?.destroy();
});

describe("language detection", () => {
  it("detects common snippets and stays null when unclear", () => {
    expect(detectLanguage('{"a": [1, 2]}')).toBe("json");
    expect(detectLanguage("SELECT id FROM orders WHERE total > 10")).toBe("sql");
    expect(detectLanguage("def run(x):\n    return x")).toBe("python");
    expect(detectLanguage("const a: number = 1;")).toBe("typescript");
    expect(detectLanguage("hola mundo")).toBeNull();
    expect(normalizeLanguage("TS")).toBe("typescript");
    expect(normalizeLanguage("klingon")).toBeNull();
  });
});

const paste = (ed: Editor, text: string): boolean | undefined => {
  const event = new Event("paste") as ClipboardEvent;
  Object.defineProperty(event, "clipboardData", {
    value: { getData: (t: string) => (t === "text/plain" ? text : "") },
  });
  return ed.view.someProp("handlePaste", (f) => f(ed.view, event, Slice.empty));
};

describe("code block language (#144)", () => {
  it("keeps the language attribute in Yjs and after reloading the doc", () => {
    const doc = new Y.Doc();
    const ed = makeEditor(doc, '<pre><code class="language-sql">select 1</code></pre>');
    expect(ed.state.doc.firstChild?.attrs.language).toBe("sql");
    const reloaded = new Y.Doc();
    Y.applyUpdate(reloaded, Y.encodeStateAsUpdate(doc));
    const ed2 = makeEditor(reloaded);
    expect(ed2.state.doc.firstChild?.type.name).toBe("codeBlock");
    expect(ed2.state.doc.firstChild?.attrs.language).toBe("sql");
  });

  it("changes the language from the selector", () => {
    const ed = makeEditor(new Y.Doc(), "<pre><code>x = 1</code></pre>");
    const select = ed.view.dom.querySelector<HTMLSelectElement>("select.fossil-code-language");
    expect(select?.value).toBe("");
    if (select === null) throw new Error("selector missing");
    select.value = "python";
    select.dispatchEvent(new Event("change"));
    expect(ed.state.doc.firstChild?.attrs.language).toBe("python");
  });

  it("detects the language when pasting into an untyped code block", () => {
    const ed = makeEditor(new Y.Doc(), "<pre><code></code></pre>");
    ed.commands.focus("start");
    expect(paste(ed, "SELECT * FROM users")).toBe(true);
    expect(ed.state.doc.firstChild?.attrs.language).toBe("sql");
    expect(ed.state.doc.textContent).toBe("SELECT * FROM users");
  });

  it("normalizes CRLF pasted from the Windows clipboard, in the doc and in Yjs", () => {
    const doc = new Y.Doc();
    const ed = makeEditor(doc, "<pre><code></code></pre>");
    ed.commands.focus("start");
    expect(paste(ed, "SELECT id\r\nFROM users\rWHERE id = 1")).toBe(true);
    expect(ed.state.doc.textContent).toBe("SELECT id\nFROM users\nWHERE id = 1");
    expect(getBodyFragment(doc).toString()).not.toContain("\r");
  });

  it("leaves the default paste alone when the selection spans several blocks", () => {
    const ed = makeEditor(new Y.Doc(), "<pre><code>abc</code></pre><p>def</p>");
    ed.commands.setTextSelection({ from: 2, to: ed.state.doc.content.size - 1 });
    expect(paste(ed, "SELECT 1 FROM t")).toBeFalsy();
    expect(ed.state.doc.firstChild?.attrs.language ?? null).toBeNull();
  });
});
