import type { Editor } from "@tiptap/core";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { Placeholder } from "@tiptap/extensions";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useEffect, useRef, useState } from "react";
import * as Y from "yjs";
import { BlockId } from "./block-id";
import { Callout, TABLE_EXTENSIONS } from "./blocks";
import { CodeBlockLanguage } from "./code-block";
import { DragHandle, EditorWordCount } from "./controls";
import { defaultEditorTranslator, type EditorTranslator } from "./i18n";
import { ImageAttachment } from "./image-attachment";
import {
  type AmbiguousLinkPick,
  LinkAutocompleteMenu,
  type LinkAutocompleteProps,
  LinksExtension,
  refreshLinkDecorations,
} from "./links";
import { Outliner } from "./outliner";
import { SafeLink } from "./safe-links";
import { SlashMenu } from "./slash-menu";
import { createUpdateBatcher, type DocTransport, type SaveStatus } from "./transport";
import { YSync } from "./y-sync";

/** Yjs body fragment key (docs/specs/r1-objects-storage.md). */
export const BODY_FRAGMENT_KEY = "body";

/** The object body fragment the editor binds to (ADR-0003). */
export function getBodyFragment(doc: Y.Doc): Y.XmlFragment {
  return doc.getXmlFragment(BODY_FRAGMENT_KEY);
}

export interface FossilEditorProps extends Omit<LinkAutocompleteProps, "editor" | "t"> {
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
  /** Called when the Yjs transport batcher status changes (#164). */
  onSaveStatusChange?: (status: SaveStatus, retry: () => Promise<void>) => void;
  className?: string;
}

/** Origin marker for updates coming from `transport.load()`, so they are not echoed back. */
const REMOTE = Symbol("fossil.remote");

interface BoundEditorProps extends Omit<LinkAutocompleteProps, "editor"> {
  doc: Y.Doc;
  transport: DocTransport;
  onReady?: ((editor: Editor) => void) | undefined;
  onError?: ((error: unknown) => void) | undefined;
  className?: string | undefined;
}

function BoundEditor({ doc, transport, t, onReady, className, ...rest }: BoundEditorProps) {
  // The placeholder reads `t` through a ref so a language change does not rebuild the editor.
  const tRef = useRef(t);
  tRef.current = t;
  const onOpenRef = useRef(rest.onOpenObject);
  onOpenRef.current = rest.onOpenObject;
  const onErrorRef = useRef(rest.onError);
  onErrorRef.current = rest.onError;
  const ambiguousRef = useRef(rest.ambiguousTitles);
  ambiguousRef.current = rest.ambiguousTitles;
  const pickRef = useRef<((pick: AmbiguousLinkPick) => void) | undefined>(undefined);
  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({
          undoRedo: false,
          heading: { levels: [1, 2, 3] },
          codeBlock: false,
          link: false,
        }),
        CodeBlockLanguage.configure({ t }),
        SafeLink,
        TaskList,
        TaskItem.configure({ nested: true }),
        Callout,
        ...TABLE_EXTENSIONS,
        ImageAttachment.configure({ transport, t, onError: (e) => onErrorRef.current?.(e) }),
        BlockId,
        Placeholder.configure({ placeholder: () => tRef.current("editor.placeholder") }),
        Outliner.configure({ t }),
        DragHandle.configure({ t }),
        LinksExtension.configure({ onOpenRef, ambiguousRef, onAmbiguousRef: pickRef, tRef }),
        YSync(getBodyFragment(doc)),
      ],
      immediatelyRender: true,
      editorProps: { attributes: { class: "fossil-editor" } },
    },
    [doc, transport],
  );
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  useEffect(() => {
    if (editor !== null) onReadyRef.current?.(editor);
  }, [editor]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: new repeated titles re-mark the open page without waiting for an edit (#137).
  useEffect(() => {
    if (editor !== null && !editor.isDestroyed) refreshLinkDecorations(editor);
  }, [editor, rest.ambiguousTitles]);
  return (
    <div className="fossil-editor-root">
      <EditorContent editor={editor} className={className} />
      <EditorWordCount editor={editor} t={t} />
      <SlashMenu editor={editor} t={t} />
      <LinkAutocompleteMenu editor={editor} t={t} pickRef={pickRef} {...rest} />
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
  onSaveStatusChange,
  className,
  ...linkProps
}: FossilEditorProps) {
  const [loadedPair, setLoadedPair] = useState<{ doc: Y.Doc; transport: DocTransport } | null>(
    null,
  );
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const onSaveStatusRef = useRef(onSaveStatusChange);
  onSaveStatusRef.current = onSaveStatusChange;

  useEffect(() => {
    let cancelled = false;
    const retry = (): Promise<void> => batcher.retry();
    const batcher = createUpdateBatcher(transport, {
      onError: (err: unknown) => onErrorRef.current?.(err),
      onStatusChange: (status) => {
        if (!cancelled) onSaveStatusRef.current?.(status, retry);
      },
    });
    onSaveStatusRef.current?.(batcher.status(), retry);
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
      batcher.dispose();
    };
  }, [doc, transport]);

  if (loadedPair?.doc !== doc || loadedPair?.transport !== transport) return null;
  const boundProps = { doc, transport, t, onReady, onError, className, ...linkProps };
  return <BoundEditor {...boundProps} />;
}
