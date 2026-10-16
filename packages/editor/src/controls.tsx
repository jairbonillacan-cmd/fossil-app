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
import { getIndent } from "./outliner";

const dragPluginKey = new PluginKey<DecorationSet>("fossilDragHandle");
export const DRAG_MIME = "application/x-fossil-block-index";
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

/** Index just past the branch rooted at `index`: the following blocks with a deeper `indent`. */
export function branchEnd(doc: ProseMirrorNode, index: number): number {
  const root = getIndent(doc.child(index));
  let end = index + 1;
  while (end < doc.childCount && getIndent(doc.child(end)) > root) end += 1;
  return end;
}

/**
 * Moves the branch rooted at `fromIndex` (the block plus its deeper-indented descendants) so it
 * lands where block `toIndex` is: before it when moving up, after `toIndex`'s own branch when
 * moving down. Nodes are reused as-is, so every `blockId` is preserved.
 */
export function moveTopBranch(
  state: EditorState,
  dispatch: Dispatch,
  fromIndex: number,
  toIndex: number,
): boolean {
  const { doc } = state;
  const count = doc.childCount;
  if (fromIndex < 0 || fromIndex >= count || toIndex < 0 || toIndex >= count) return false;
  const end = branchEnd(doc, fromIndex);
  if (toIndex >= fromIndex && toIndex < end) return false;
  const posOf = (index: number): number => {
    let pos = 0;
    for (let i = 0; i < index; i++) pos += doc.child(i).nodeSize;
    return pos;
  };
  const from = posOf(fromIndex);
  const to = posOf(end);
  const branch = doc.slice(from, to).content;
  // Position of the drop point in the original doc, mapped past the removed range if it follows it.
  const dropIndex = toIndex < fromIndex ? toIndex : branchEnd(doc, toIndex);
  const drop = posOf(dropIndex);
  const insertAt = drop > from ? drop - (to - from) : drop;
  const tr = state.tr.delete(from, to).insert(insertAt, branch).setMeta(dragPluginKey, true);
  const sel = Math.min(insertAt + 1, tr.doc.content.size);
  dispatch?.(tr.setSelection(TextSelection.near(tr.doc.resolve(sel))));
  return true;
}

/** Moves the branch rooted at `idx` one step (`-1` up, `+1` down), children included (#77). */
export function stepTopBranch(
  state: EditorState,
  dispatch: Dispatch,
  idx: number,
  delta: -1 | 1,
): boolean {
  const { doc } = state;
  if (delta === 1) {
    const end = branchEnd(doc, idx);
    return end < doc.childCount && moveTopBranch(state, dispatch, idx, end);
  }
  if (idx === 0) return false;
  // A deeper previous block is the tail of a previous sibling branch: jump to that branch's root.
  const level = getIndent(doc.child(idx));
  let target = idx - 1;
  if (getIndent(doc.child(target)) > level) {
    let k = idx - 1;
    while (k > 0 && getIndent(doc.child(k)) > level) k -= 1;
    if (getIndent(doc.child(k)) === level) target = k;
    // If previous blocks are deeper without a matching sibling level (e.g. [0, 2, 1]), target falls back to idx - 1.
  }
  return moveTopBranch(state, dispatch, idx, target);
}

/** Moves the branch containing the current selection by `delta` (`-1` up, `+1` down). */
export function moveCurrentTopBlock(
  state: EditorState,
  dispatch: Dispatch,
  delta: -1 | 1,
): boolean {
  if (state.selection.$from.depth < 1) return false;
  return stepTopBranch(state, dispatch, state.selection.$from.index(0), delta);
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
              const delta = e.key === "ArrowUp" ? -1 : 1;
              if (stepTopBranch(view.state, view.dispatch, blockIdx, delta)) {
                // The moved root's new index: the selection was placed on it by the move.
                const target = view.state.selection.$from.index(0);
                const nextBtn = view.dom.querySelector<HTMLButtonElement>(
                  `.fossil-drag-handle[data-block-index="${target}"]`,
                );
                nextBtn?.focus();
              }
            }
          };
          btn.ondragstart = (e) => {
            draggedBlockIndex = blockIdx;
            e.dataTransfer?.setData(DRAG_MIME, String(blockIdx));
            e.dataTransfer?.setData("text/plain", String(blockIdx));
          };
          btn.ondragend = () => {
            draggedBlockIndex = null;
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

function canMapDragDecorations(
  tr: Transaction,
  oldDoc: ProseMirrorNode,
  newDoc: ProseMirrorNode,
): boolean {
  if (tr.getMeta(dragPluginKey) || oldDoc.childCount !== newDoc.childCount) return false;
  let changed = 0;
  for (let i = 0; i < newDoc.childCount; i++) {
    const a = oldDoc.child(i);
    const b = newDoc.child(i);
    if (a !== b) {
      changed += 1;
      if (changed > 1 || a.type !== b.type || a.isLeaf !== b.isLeaf) return false;
    }
  }
  return !tr.steps.some((step) => (step as { from?: number }).from === 0);
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
          apply: (tr, prev, oldState, newState) =>
            !tr.docChanged && !tr.getMeta(dragPluginKey)
              ? prev
              : canMapDragDecorations(tr, oldState.doc, newState.doc)
                ? prev.map(tr.mapping, newState.doc)
                : buildDragDecorations(newState.doc, t),
        },
        props: {
          decorations: (state) => dragPluginKey.getState(state),
          handleDOMEvents: {
            dragover: (_view, e) => {
              if (
                draggedBlockIndex !== null ||
                (e.dataTransfer?.types?.includes(DRAG_MIME) ?? false)
              ) {
                e.preventDefault();
              }
              return false;
            },
            dragend: () => {
              draggedBlockIndex = null;
              return false;
            },
            drop: (view, e) => {
              const mimeData = e.dataTransfer?.getData(DRAG_MIME) ?? "";
              const hasMime =
                mimeData.length > 0 || (e.dataTransfer?.types?.includes(DRAG_MIME) ?? false);
              const raw =
                mimeData || (hasMime ? (e.dataTransfer?.getData("text/plain") ?? "") : "");
              const fromIdx =
                draggedBlockIndex ?? (/^\d+$/.test(raw) ? Number.parseInt(raw, 10) : Number.NaN);
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
              return moveTopBranch(view.state, view.dispatch, fromIdx, toIdx);
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

/** Computes word and character counts across all textblocks in `doc` in a single pass. */
export function countDocumentStats(doc: ProseMirrorNode): EditorDocumentStats {
  let words = 0;
  let characters = 0;
  let inWord = false;
  doc.descendants((node) => {
    if (node.isTextblock) {
      inWord = false;
      return true;
    }
    if (node.isText && node.text) {
      const text = node.text;
      characters += text.length;
      for (let i = 0; i < text.length; i++) {
        const c = text.charCodeAt(i);
        if (c === 32 || (c >= 9 && c <= 13) || c === 160) {
          inWord = false;
        } else if (!inWord) {
          inWord = true;
          words += 1;
        }
      }
      return false;
    }
    if (node.isLeaf) inWord = false;
    return true;
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
    editor.on("update", sync);
    return () => {
      editor.off("update", sync);
    };
  }, [editor]);

  if (editor === null) return null;
  return (
    <output className="fossil-word-count" aria-live="polite">
      {`${stats.words} ${t("editor.stats.words")} · ${stats.characters} ${t("editor.stats.characters")}`}
    </output>
  );
}
