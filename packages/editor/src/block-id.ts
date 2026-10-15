import { Extension } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { ySyncPluginKey } from "y-prosemirror";

/** Top-level block node types that carry a stable `blockId` (ADR-0005, ADR-0015). */
export const BLOCK_ID_TYPES = [
  "paragraph",
  "heading",
  "bulletList",
  "orderedList",
  "taskList",
  "blockquote",
  "codeBlock",
  "callout",
  "horizontalRule",
  "table",
  "image",
] as const;

const BLOCK_ID_TYPE_SET: ReadonlySet<string> = new Set(BLOCK_ID_TYPES);
const blockIdPluginKey = new PluginKey("fossilBlockId");

function keepsValidTopLevelBlockIds(oldDoc: ProseMirrorNode, newDoc: ProseMirrorNode): boolean {
  if (oldDoc.childCount !== newDoc.childCount) return false;
  for (let i = 0; i < newDoc.childCount; i++) {
    const next = newDoc.child(i);
    const prev = oldDoc.child(i);
    if (!BLOCK_ID_TYPE_SET.has(next.type.name)) continue;
    const nextId = next.attrs.blockId;
    if (typeof nextId !== "string" || nextId.length === 0) return false;
    if (next !== prev && nextId !== prev.attrs.blockId) return false;
  }
  return true;
}

/**
 * Attaches a global `blockId` attribute (`data-block-id` in DOM) to top-level block nodes
 * and ensures every new or split (duplicated) top-level block receives a fresh UUID via
 * `appendTransaction` (ADR-0015).
 */
export const BlockId = Extension.create({
  name: "blockId",

  addGlobalAttributes() {
    return [
      {
        types: [...BLOCK_ID_TYPES],
        attributes: {
          blockId: {
            default: null,
            parseHTML: (element: HTMLElement) => element.getAttribute("data-block-id"),
            renderHTML: (attributes: Record<string, unknown>) =>
              typeof attributes.blockId === "string" && attributes.blockId.length > 0
                ? { "data-block-id": attributes.blockId }
                : {},
          },
        },
      },
    ];
  },

  onCreate() {
    // When bound to Yjs, ySyncPlugin owns initial doc population and opening an empty
    // fragment must not write back to storage; standalone editors dispatch an init tr.
    if (ySyncPluginKey.getState(this.editor.state) !== undefined) return;
    this.editor.view.dispatch(this.editor.state.tr.setMeta(blockIdPluginKey, true));
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: blockIdPluginKey,
        appendTransaction(transactions, oldState, newState) {
          if (transactions.some((tr) => Boolean(tr.getMeta(ySyncPluginKey)))) {
            return null;
          }
          const forceInit = transactions.some((tr) => Boolean(tr.getMeta(blockIdPluginKey)));
          if (!forceInit && !transactions.some((tr) => tr.docChanged)) {
            return null;
          }
          if (!forceInit && keepsValidTopLevelBlockIds(oldState.doc, newState.doc)) {
            return null;
          }
          const seen = new Set<string>();
          let tr = newState.tr;
          let modified = false;

          newState.doc.forEach((node, offset) => {
            if (!BLOCK_ID_TYPE_SET.has(node.type.name)) return;
            const current = node.attrs.blockId;
            if (typeof current === "string" && current.length > 0 && !seen.has(current)) {
              seen.add(current);
              return;
            }
            const fresh = crypto.randomUUID();
            seen.add(fresh);
            tr = tr.setNodeAttribute(offset, "blockId", fresh);
            modified = true;
          });

          if (!modified) return null;
          tr.setMeta("addToHistory", false);
          return tr;
        },
      }),
    ];
  },
});
