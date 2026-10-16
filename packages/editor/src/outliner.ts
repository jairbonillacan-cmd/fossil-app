import { Extension } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { type EditorState, Plugin, PluginKey, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import { BLOCK_ID_TYPES } from "./block-id";
import { defaultEditorTranslator, type EditorTranslator } from "./i18n";

export const MAX_OUTLINER_INDENT = 6;
const outlinerPluginKey = new PluginKey<DecorationSet>("fossilOutliner");
const CHEVRON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>';
type Dispatch = ((tr: Transaction) => void) | undefined;

const clampIndent = (v: unknown): number =>
  Math.max(0, Math.min(MAX_OUTLINER_INDENT, Number.parseInt(String(v ?? 0), 10) || 0));
export const getIndent = (n: ProseMirrorNode): number => clampIndent(n.attrs.indent);
const getLevel = (n: ProseMirrorNode): number =>
  n.type.name === "heading" ? Number(n.attrs.level) || 0 : 0;

/** Adjusts the top-level block's `indent` attribute by `delta` (`+1` or `-1`). */
export function shiftTopBlockIndent(st: EditorState, dispatch: Dispatch, delta: 1 | -1): boolean {
  if (st.selection.$from.depth < 1) return false;
  const pos = st.selection.$from.before(1);
  const node = st.doc.nodeAt(pos);
  if (!node) return false;
  const next = clampIndent(getIndent(node) + delta);
  if (next !== getIndent(node)) {
    const tr = st.tr.setNodeMarkup(pos, undefined, { ...node.attrs, indent: next });
    dispatch?.(tr.setMeta(outlinerPluginKey, true));
  }
  return true;
}

/** Toggles the `collapsed` attribute on the top-level block at `pos`. */
export function toggleBlockFoldAtPos(st: EditorState, dispatch: Dispatch, pos: number): boolean {
  const node = st.doc.nodeAt(pos);
  if (!node) return false;
  const tr = st.tr.setNodeMarkup(pos, undefined, {
    ...node.attrs,
    collapsed: !node.attrs.collapsed,
  });
  dispatch?.(tr.setMeta(outlinerPluginKey, true));
  return true;
}

function isFoldableAt(doc: ProseMirrorNode, i: number): boolean {
  const node = doc.child(i);
  if (node.attrs.collapsed === true) return true;
  if (i + 1 >= doc.childCount) return false;
  const next = doc.child(i + 1);
  if (getIndent(next) > getIndent(node)) return true;
  const lvl = getLevel(node);
  const nextLvl = getLevel(next);
  return lvl > 0 && (nextLvl === 0 || nextLvl > lvl);
}

function createFoldWidget(node: ProseMirrorNode, pos: number, fold: boolean, t: EditorTranslator) {
  let wPos = node.isAtom ? pos : pos + 1;
  for (let c = node; !c.isAtom && !c.isTextblock && c.firstChild; c = c.firstChild) wPos += 1;
  const label = t(fold ? "editor.outliner.expand" : "editor.outliner.collapse");
  return Decoration.widget(
    wPos,
    (view: EditorView) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "fossil-fold-btn";
      btn.contentEditable = "false";
      btn.title = label;
      btn.innerHTML = CHEVRON_SVG;
      btn.dataset.collapsed = String(fold);
      btn.setAttribute("aria-expanded", String(!fold));
      btn.setAttribute("aria-label", label);
      btn.onmousedown = (e) => {
        e.preventDefault();
        const blockPos = view.state.doc.resolve(view.posAtDOM(btn, 0)).before(1);
        toggleBlockFoldAtPos(view.state, view.dispatch, blockPos);
      };
      return btn;
    },
    { side: -1, key: fold ? "fold-c" : "fold-o" },
  );
}

/** Single-pass O(N) builder for fold widgets and hidden-block node decorations. */
export function buildOutlinerDecorations(doc: ProseMirrorNode, t: EditorTranslator): DecorationSet {
  const decorations: Decoration[] = [];
  let foldHeading: number | null = null;
  let foldIndent: number | null = null;
  for (let i = 0, pos = 0; i < doc.childCount; i++) {
    const node = doc.child(i);
    const level = getLevel(node);
    const indent = getIndent(node);
    const collapsed = node.attrs.collapsed === true;
    if (foldHeading !== null && level > 0 && level <= foldHeading) foldHeading = null;
    if (foldIndent !== null && indent <= foldIndent) foldIndent = null;
    if (foldHeading !== null || foldIndent !== null) {
      decorations.push(Decoration.node(pos, pos + node.nodeSize, { class: "fossil-block-hidden" }));
    } else {
      if (collapsed && level > 0) foldHeading = level;
      else if (collapsed) foldIndent = indent;
      if (isFoldableAt(doc, i)) decorations.push(createFoldWidget(node, pos, collapsed, t));
    }
    pos += node.nodeSize;
  }
  return DecorationSet.create(doc, decorations);
}

function canMapOnly(tr: Transaction, oldDoc: ProseMirrorNode, newDoc: ProseMirrorNode): boolean {
  if (tr.getMeta(outlinerPluginKey) || oldDoc.childCount !== newDoc.childCount) return false;
  let idx = -1;
  for (let i = 0; i < newDoc.childCount; i++) {
    if (oldDoc.child(i) !== newDoc.child(i)) {
      if (idx !== -1) return false;
      idx = i;
    }
  }
  if (idx === -1) return true;
  const a = oldDoc.child(idx);
  const b = newDoc.child(idx);
  return (
    a.type === b.type &&
    getIndent(a) === getIndent(b) &&
    !a.attrs.collapsed === !b.attrs.collapsed &&
    getLevel(a) === getLevel(b)
  );
}

const FORBIDDEN_PASTE_TAGS =
  "script, style, meta, link, title, xml, iframe, object, svg, template, math, embed, form, textarea, select, button, audio, video, source, track";

function normalizeNbspInTextNodes(root: Node): void {
  for (const child of Array.from(root.childNodes)) {
    if (child.nodeType === 3 && child.nodeValue) {
      child.nodeValue = child.nodeValue.replace(/\u00a0/g, " ");
    } else {
      normalizeNbspInTextNodes(child);
    }
  }
}

/** Strips foreign styles, classes, and external wrapper noise from pasted HTML. */
export function cleanPastedHTML(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  for (const el of Array.from(doc.querySelectorAll(FORBIDDEN_PASTE_TAGS))) {
    el.remove();
  }
  for (const input of Array.from(doc.querySelectorAll("input"))) {
    if ((input.getAttribute("type") ?? "").toLowerCase() !== "checkbox") {
      input.remove();
    } else {
      input.setAttribute("type", "checkbox");
    }
  }
  for (const el of Array.from(doc.body.querySelectorAll("[style]"))) {
    normalizeNbspInTextNodes(el);
  }
  for (const b of Array.from(doc.querySelectorAll("b,strong"))) {
    if (/font-weight\s*:\s*(normal|400)\b/i.test(b.getAttribute("style") ?? "")) {
      const s = doc.createElement("span");
      s.replaceChildren(...Array.from(b.childNodes));
      b.replaceWith(s);
    }
  }
  for (const span of Array.from(doc.querySelectorAll("span"))) {
    const st = span.getAttribute("style") ?? "";
    const bold = /font-weight\s*:\s*(bold|[6-9]00)\b/i.test(st);
    const italic = /font-style\s*:\s*italic\b/i.test(st);
    if (bold || italic) {
      const outer = doc.createElement(bold ? "strong" : "em");
      outer.replaceChildren(...Array.from(span.childNodes));
      if (bold && italic) {
        const em = doc.createElement("em");
        em.replaceChildren(...Array.from(outer.childNodes));
        outer.replaceChildren(em);
      }
      span.replaceWith(outer);
    }
  }
  for (const el of Array.from(doc.body.querySelectorAll("*"))) {
    const tag = el.tagName.toLowerCase();
    for (const a of Array.from(el.attributes)) {
      const k = a.name.toLowerCase();
      const keep =
        (tag === "a" && k === "href" && /^(https?:\/\/|mailto:)/i.test(a.value)) ||
        (tag === "ul" && k === "data-type" && a.value === "taskList") ||
        (tag === "aside" && k === "data-type" && a.value === "callout") ||
        (tag === "li" && k === "data-checked") ||
        (tag === "input" && (k === "type" || k === "checked"));
      if (!keep) el.removeAttribute(a.name);
    }
  }
  normalizeNbspInTextNodes(doc.body);
  return doc.body.innerHTML.replace(/\u00a0/g, " ");
}

/** Normalizes line endings and non-breaking spaces in plain-text paste. */
export const cleanPastedText = (text: string): string =>
  text.replace(/\r\n?/g, "\n").replace(/\u00a0/g, " ");

/** Outliner (`Tab`/`Shift+Tab` indent, block & section folding) and clean paste extension (#25). */
export const Outliner = Extension.create<{ t: EditorTranslator }>({
  name: "outliner",
  addOptions: () => ({ t: defaultEditorTranslator }),
  addGlobalAttributes: () => [
    {
      types: [...BLOCK_ID_TYPES],
      attributes: {
        indent: {
          default: 0,
          parseHTML: (el: HTMLElement) => clampIndent(el.getAttribute("data-indent")),
          renderHTML: (a: Record<string, unknown>) => {
            const indent = clampIndent(a.indent);
            return indent > 0
              ? { "data-indent": String(indent), style: `--indent: ${indent}` }
              : {};
          },
        },
        collapsed: {
          default: false,
          parseHTML: (el: HTMLElement) => el.getAttribute("data-collapsed") === "true",
          renderHTML: (a: Record<string, unknown>) =>
            a.collapsed === true ? { "data-collapsed": "true" } : {},
        },
      },
    },
  ],
  addKeyboardShortcuts() {
    const move = (dir: 1 | -1, cmd: "sinkListItem" | "liftListItem") =>
      this.editor.commands[cmd]("listItem") ||
      this.editor.commands[cmd]("taskItem") ||
      shiftTopBlockIndent(this.editor.state, this.editor.view.dispatch, dir);
    return { Tab: () => move(1, "sinkListItem"), "Shift-Tab": () => move(-1, "liftListItem") };
  },
  addProseMirrorPlugins() {
    const { t } = this.options;
    return [
      new Plugin<DecorationSet>({
        key: outlinerPluginKey,
        state: {
          init: (_, state) => buildOutlinerDecorations(state.doc, t),
          apply: (tr, prev, oldState, newState) =>
            !tr.docChanged && !tr.getMeta(outlinerPluginKey)
              ? prev
              : canMapOnly(tr, oldState.doc, newState.doc)
                ? prev.map(tr.mapping, newState.doc)
                : buildOutlinerDecorations(newState.doc, t),
        },
        props: {
          decorations: (state) => outlinerPluginKey.getState(state),
          transformPastedHTML: cleanPastedHTML,
          transformPastedText: cleanPastedText,
        },
      }),
    ];
  },
});
