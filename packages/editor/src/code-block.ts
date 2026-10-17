import { getRenderedAttributes } from "@tiptap/core";
import { CodeBlock } from "@tiptap/extension-code-block";
import { Plugin } from "@tiptap/pm/state";
import { CODE_LANGUAGES, detectLanguage, normalizeLanguage } from "./code-languages";
import { defaultEditorTranslator, type EditorTranslator } from "./i18n";

export interface CodeBlockOptions {
  t: EditorTranslator;
}

/**
 * `codeBlock` with a language selector and language detection on paste (#144). The language is the
 * node attribute `language` (a supported id such as `typescript`, or absent/`null` for plain text).
 */
export const CodeBlockLanguage = CodeBlock.extend<CodeBlockOptions>({
  addOptions() {
    return { ...this.parent?.(), t: defaultEditorTranslator };
  },

  addNodeView() {
    const { t } = this.options;
    return ({ node: initial, editor, getPos, HTMLAttributes }) => {
      let node = initial;
      const dom = document.createElement("pre");
      for (const [k, v] of Object.entries(HTMLAttributes)) dom.setAttribute(k, String(v));
      dom.spellcheck = false;
      const bar = document.createElement("div");
      bar.className = "fossil-code-bar";
      bar.contentEditable = "false";
      const select = document.createElement("select");
      select.className = "fossil-code-language";
      select.setAttribute("aria-label", t("editor.code.language"));
      const plain = new Option(t("editor.code.plain"), "");
      select.append(plain, ...CODE_LANGUAGES.map((l) => new Option(l.label, l.id)));
      const sync = () => {
        select.value = normalizeLanguage(node.attrs.language) ?? "";
      };
      sync();
      select.addEventListener("change", () => {
        const pos = getPos();
        if (pos === undefined) return;
        const language = select.value === "" ? null : select.value;
        editor.view.dispatch(editor.state.tr.setNodeAttribute(pos, "language", language));
        editor.view.focus();
      });
      bar.append(select);
      const code = document.createElement("code");
      dom.append(bar, code);
      return {
        dom,
        contentDOM: code,
        stopEvent: (event) => event.target === select,
        ignoreMutation: (m) => m.target === select || m.target === bar || bar.contains(m.target),
        update(updated) {
          if (updated.type !== node.type) return false;
          node = updated;
          const rendered = getRenderedAttributes(updated, editor.extensionManager.attributes);
          for (const name of ["data-block-id", "data-indent", "data-collapsed", "style"]) {
            const value = rendered[name];
            if (value === undefined || value === null || value === false) dom.removeAttribute(name);
            else dom.setAttribute(name, String(value));
          }
          sync();
          return true;
        },
      };
    };
  },

  addProseMirrorPlugins() {
    return [
      ...(this.parent?.() ?? []),
      new Plugin({
        props: {
          handlePaste: (view, event) => {
            const text = event.clipboardData?.getData("text/plain") ?? "";
            const { $from } = view.state.selection;
            const block = $from.parent;
            if (block.type !== this.type || normalizeLanguage(block.attrs.language) !== null)
              return false;
            if (text.length === 0 || event.clipboardData?.getData("vscode-editor-data"))
              return false;
            const language = detectLanguage(text);
            if (language === null) return false;
            const tr = view.state.tr.setNodeAttribute($from.before(), "language", language);
            view.dispatch(tr.insertText(text).scrollIntoView());
            return true;
          },
        },
      }),
    ];
  },
});
