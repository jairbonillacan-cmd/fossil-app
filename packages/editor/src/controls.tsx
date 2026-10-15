import { type Editor, Extension } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import {
  type EditorState,
  Plugin,
  PluginKey,
  TextSelection,
  type Transaction,
} from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import { useEffect, useState } from "react";
import { defaultEditorTranslator, type EditorTranslator } from "./i18n";

const dragPluginKey = new PluginKey<DecorationSet>("fossilDragHandle");
const GRIP_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="5" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="19" r="1"/></svg>';
type Dispatch = ((tr: Transaction) => void) | undefined;

let draggedBlockIndex: number | null = null;

/** Reorders a top-level block from `fromIndex` to `toIndex`, preserving its `blockId` and attributes. */
export function moveTopBlock(
  state: EditorState,
  dispatch: Dispatch,
  fromIndex: number,
  toIndex: number,
): boolean {
  const count = state.doc.childCount;
  if (
    fromIndex < 0 ||
    fromIndex >= count ||
    toIndex < 0 ||
    toIndex >= count ||
    fromIndex === toIndex
  ) {
    return false;
  }
  let fromPos = 0;
  for (let i = 0; i < fromIndex; i++) fromPos += state.doc.child(i).nodeSize;
  const node = state.doc.child(fromIndex);
  let tr = state.tr.delete(fromPos, fromPos + node.nodeSize);
  let insertPos = 0;
  for (let i = 0; i < toIndex; i++) insertPos += tr.doc.child(i).nodeSize;
  tr = tr.insert(insertPos, node).setMeta(dragPluginKey, true);
  const selPos = Math.min(insertPos + 1, tr.doc.content.size);
  dispatch?.(tr.setSelection(TextSelection.near(tr.doc.resolve(selPos))));
  return true;
}

/** Moves the top-level block containing the current selection by `delta` (`-1` up, `+1` down). */
export function moveCurrentTopBlock(
  state: EditorState,
  dispatch: Dispatch,
  delta: -1 | 1,
): boolean {
  if (state.selection.$from.depth < 1) return false;
  const idx = state.selection.$from.index(0);
  return moveTopBlock(state, dispatch, idx, idx + delta);
}

function buildDragDecorations(doc: ProseMirrorNode, t: EditorTranslator): DecorationSet {
  const decorations: Decoration[] = [];
  const label = t("editor.drag.handle");
  for (let i = 0, pos = 0; i < doc.childCount; i++) {
    const node = doc.child(i);
    if (node.isLeaf) {
      pos += node.nodeSize;
      continue;
    }
    let wPos = pos + 1;
    for (let c = node; !c.isTextblock && c.firstChild; c = c.firstChild) wPos += 1;
    const blockIdx = i;
    decorations.push(
      Decoration.widget(
        wPos,
        (view: EditorView) => {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "fossil-drag-handle";
          btn.draggable = true;
          btn.contentEditable = "false";
          btn.title = label;
          btn.innerHTML = GRIP_SVG;
          btn.dataset.blockIndex = String(blockIdx);
          btn.setAttribute("aria-label", label);
          btn.onkeydown = (e) => {
            if (e.key === "ArrowUp" || e.key === "ArrowDown") {
              e.preventDefault();
              const target = blockIdx + (e.key === "ArrowUp" ? -1 : 1);
              if (moveTopBlock(view.state, view.dispatch, blockIdx, target)) {
                const nextBtn = view.dom.querySelector<HTMLButtonElement>(
                  `.fossil-drag-handle[data-block-index="${target}"]`,
                );
                nextBtn?.focus();
              }
            }
          };
          btn.ondragstart = (e) => {
            draggedBlockIndex = blockIdx;
            e.dataTransfer?.setData("text/plain", String(blockIdx));
          };
          return btn;
        },
        { side: -2, key: `drag-${blockIdx}` },
      ),
    );
    pos += node.nodeSize;
  }
  return DecorationSet.create(doc, decorations);
}

/** Accessible per-block drag handle and `Alt+ArrowUp`/`Alt+ArrowDown` reordering (#105). */
export const DragHandle = Extension.create<{ t: EditorTranslator }>({
  name: "dragHandle",
  addOptions: () => ({ t: defaultEditorTranslator }),
  addKeyboardShortcuts() {
    return {
      "Alt-ArrowUp": () => moveCurrentTopBlock(this.editor.state, this.editor.view.dispatch, -1),
      "Alt-ArrowDown": () => moveCurrentTopBlock(this.editor.state, this.editor.view.dispatch, 1),
    };
  },
  addProseMirrorPlugins() {
    const { t } = this.options;
    return [
      new Plugin<DecorationSet>({
        key: dragPluginKey,
        state: {
          init: (_, state) => buildDragDecorations(state.doc, t),
          apply: (tr, prev, _oldState, newState) =>
            !tr.docChanged && !tr.getMeta(dragPluginKey)
              ? prev
              : buildDragDecorations(newState.doc, t),
        },
        props: {
          decorations: (state) => dragPluginKey.getState(state),
          handleDOMEvents: {
            dragover: (_view, e) => {
              if (draggedBlockIndex !== null) e.preventDefault();
              return false;
            },
            drop: (view, e) => {
              const raw = e.dataTransfer?.getData("text/plain");
              const fromIdx = draggedBlockIndex ?? (raw ? Number.parseInt(raw, 10) : Number.NaN);
              draggedBlockIndex = null;
              if (Number.isNaN(fromIdx)) return false;
              const el = (e.target as HTMLElement | null)?.closest?.("[data-block-id]");
              if (!el) return false;
              const id = el.getAttribute("data-block-id");
              let toIdx = -1;
              view.state.doc.forEach((node, _offset, idx) => {
                if (node.attrs.blockId === id) toIdx = idx;
              });
              if (toIdx === -1) return false;
              e.preventDefault();
              return moveTopBlock(view.state, view.dispatch, fromIdx, toIdx);
            },
          },
        },
      }),
    ];
  },
});

export interface EditorDocumentStats {
  words: number;
  characters: number;
}

/** Computes word and character counts across all textblocks in `doc`. */
export function countDocumentStats(doc: ProseMirrorNode): EditorDocumentStats {
  const text = doc.textBetween(0, doc.content.size, " ", " ").trim();
  const words = text.length === 0 ? 0 : text.split(/\s+/).length;
  let characters = 0;
  doc.descendants((node) => {
    if (node.isText && node.text) characters += node.text.length;
  });
  return { words, characters };
}

/** Live word and character counter bar bound to the editor instance (#105). */
export function EditorWordCount({ editor, t }: { editor: Editor | null; t: EditorTranslator }) {
  const [stats, setStats] = useState<EditorDocumentStats>({ words: 0, characters: 0 });

  useEffect(() => {
    if (editor === null) return;
    const sync = () => setStats(countDocumentStats(editor.state.doc));
    sync();
    editor.on("transaction", sync);
    return () => {
      editor.off("transaction", sync);
    };
  }, [editor]);

  if (editor === null) return null;
  return (
    <output className="fossil-word-count" aria-live="polite">
      {`${stats.words} ${t("editor.stats.words")} · ${stats.characters} ${t("editor.stats.characters")}`}
    </output>
  );
}
