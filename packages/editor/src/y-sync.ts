import { Extension } from "@tiptap/core";
import { keymap } from "@tiptap/pm/keymap";
import { redo, undo, ySyncPlugin, yUndoPlugin } from "y-prosemirror";
import type { XmlFragment } from "yjs";

/**
 * Binds the editor to the Yjs body fragment (ADR-0003) and owns undo/redo through
 * `Y.UndoManager` (yUndoPlugin), scoped to the local client. StarterKit's undoRedo
 * must be disabled when this is used (ADR-0015).
 */
export const YSync = (fragment: XmlFragment): Extension =>
  Extension.create({
    name: "ySync",
    addProseMirrorPlugins() {
      return [
        ySyncPlugin(fragment),
        yUndoPlugin(),
        // y-prosemirror exports plain ProseMirror commands; wire the keys ourselves.
        keymap({ "Mod-z": undo, "Mod-y": redo, "Mod-Shift-z": redo }),
      ];
    },
  });
