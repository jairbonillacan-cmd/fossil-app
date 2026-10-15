import { type EditorTranslator, FossilEditor } from "@fossil/editor";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import * as Y from "yjs";
import type { ObjectId } from "./bindings";
import { createObjectTransport, DocTransportError } from "./doc-transport";

/**
 * Page body (#58): the real block editor bound to the object's Yjs document.
 * One `Y.Doc` and one transport per object, stable across renders so the
 * editor loads the body once and only sends real edits. The parent keys this
 * component by object id; the doc is created in an effect and destroyed in its
 * cleanup (StrictMode-safe: a remount gets a fresh doc, never a destroyed one).
 */
export function PageBody({ objectId }: { objectId: ObjectId }) {
  const { t } = useTranslation();
  const [doc, setDoc] = useState<Y.Doc | null>(null);
  useEffect(() => {
    const fresh = new Y.Doc();
    setDoc(fresh);
    return () => fresh.destroy();
  }, []);
  const transport = useMemo(() => createObjectTransport(objectId), [objectId]);
  const [failed, setFailed] = useState<string | null>(null);
  // The editor's `editor.slash.*` strings come from the app catalog, so they follow the language setting.
  const editorT = useCallback<EditorTranslator>((key) => t(key), [t]);

  const onError = (error: unknown) => {
    const detail = error instanceof DocTransportError ? error.message : String(error);
    setFailed(
      error instanceof DocTransportError && error.error === "NotImplemented"
        ? t("error.notImplemented")
        : t("error.generic", { error: detail }),
    );
  };

  return (
    <div className="flex flex-1 flex-col gap-2">
      {failed !== null && (
        <p role="alert" className="text-sm text-[color:var(--danger)]">
          {failed}
        </p>
      )}
      {doc !== null && (
        <FossilEditor
          key={objectId}
          doc={doc}
          transport={transport}
          t={editorT}
          onError={onError}
          className="flex-1"
        />
      )}
    </div>
  );
}
