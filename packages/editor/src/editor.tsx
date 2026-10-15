import type { Editor } from "@tiptap/core";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { Placeholder } from "@tiptap/extensions";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useEffect, useRef, useState } from "react";
import * as Y from "yjs";
import { BlockId } from "./block-id";
import { defaultEditorTranslator, type EditorTranslator } from "./i18n";
import { SlashMenu } from "./slash-menu";
import { createUpdateBatcher, type DocTransport } from "./transport";
import { YSync } from "./y-sync";

/** Yjs body fragment key (docs/specs/r1-objects-storage.md). */
export const BODY_FRAGMENT_KEY = "body";

/** The object body fragment the editor binds to (ADR-0003). */
export function getBodyFragment(doc: Y.Doc): Y.XmlFragment {
  return doc.getXmlFragment(BODY_FRAGMENT_KEY);
}

export interface FossilEditorProps {
  /** Object body document (ADR-0003). */
  doc: Y.Doc;
  /** Persistence bridge. Must be referentially stable per object (memoized) so it does not reload. */
  transport: DocTransport;
  /** Translator for `editor.*` UI strings (defaults to es-MX). */
  t?: EditorTranslator;
  /** Called with the TipTap instance once it is ready (toolbars, counters). */
  onReady?: (editor: Editor) => void;
  /** Called when `load` or `apply` fail. */
  onError?: (error: unknown) => void;
  className?: string;
}

/** Origin marker for updates coming from `transport.load()`, so they are not echoed back. */
const REMOTE = Symbol("fossil.remote");

interface BoundEditorProps {
  doc: Y.Doc;
  t: EditorTranslator;
  onReady?: ((editor: Editor) => void) | undefined;
  className?: string | undefined;
}

function BoundEditor({ doc, t, onReady, className }: BoundEditorProps) {
  // The placeholder reads `t` through a ref so a language change does not rebuild the editor.
  const tRef = useRef(t);
  tRef.current = t;
  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({
          undoRedo: false,
          heading: { levels: [1, 2, 3] },
          codeBlock: { HTMLAttributes: { spellcheck: "false" } },
        }),
        TaskList,
        TaskItem.configure({ nested: true }),
        BlockId,
        Placeholder.configure({ placeholder: () => tRef.current("editor.placeholder") }),
        YSync(getBodyFragment(doc)),
      ],
      immediatelyRender: true,
      editorProps: { attributes: { class: "fossil-editor" } },
    },
    [doc],
  );
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  useEffect(() => {
    if (editor !== null) onReadyRef.current?.(editor);
  }, [editor]);
  return (
    <div className="fossil-editor-root">
      <EditorContent editor={editor} className={className} />
      <SlashMenu editor={editor} t={t} />
    </div>
  );
}

/** Block editor bound to a Yjs body. Alpha scope: paragraph, H1-H3, lists, task list, quote, code. */
export function FossilEditor({
  doc,
  transport,
  t = defaultEditorTranslator,
  onReady,
  onError,
  className,
}: FossilEditorProps) {
  const [loadedPair, setLoadedPair] = useState<{ doc: Y.Doc; transport: DocTransport } | null>(
    null,
  );
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  useEffect(() => {
    let cancelled = false;
    const batcher = createUpdateBatcher(transport, {
      onError: (err: unknown) => onErrorRef.current?.(err),
    });
    const onUpdate = (update: Uint8Array, origin: unknown) => {
      if (origin !== REMOTE) batcher.push(update);
    };
    doc.on("update", onUpdate);
    void transport
      .load()
      .then((bytes) => {
        if (cancelled) return;
        if (bytes.byteLength > 0) Y.applyUpdate(doc, bytes, REMOTE);
        setLoadedPair({ doc, transport });
      })
      .catch((err: unknown) => {
        if (!cancelled) onErrorRef.current?.(err);
      });
    return () => {
      cancelled = true;
      doc.off("update", onUpdate);
      batcher.flush();
    };
  }, [doc, transport]);

  if (loadedPair?.doc !== doc || loadedPair?.transport !== transport) return null;
  return <BoundEditor doc={doc} t={t} onReady={onReady} className={className} />;
}
