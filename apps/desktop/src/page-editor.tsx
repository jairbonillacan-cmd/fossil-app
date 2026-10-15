import { Button } from "@fossil/ui";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ObjectMeta } from "./bindings";
import { commands } from "./bindings";
import { PageBody } from "./page-body";
import { PageBacklinksPanel } from "./page-editor-backlinks";
import { exportObjectMarkdown } from "./page-export";
import { registerCommand } from "./shell-commands";
import { PageFindBar } from "./shell-search";
import { formatObjectTitle } from "./sidebar";

const TITLE_COMMIT_MS = 400;

export interface PageEditorProps {
  object: ObjectMeta | null;
  onSelect?: ((object: ObjectMeta) => void) | undefined;
}

/** Page header (`object_update_meta`, 400 ms debounce + blur), body and collapsible backlinks panel (#26, #28). */
export function PageEditor({ object, onSelect }: PageEditorProps) {
  const { t, i18n } = useTranslation();
  const [title, setTitle] = useState("");
  const pendingRef = useRef<string | null>(null);
  const [exportFailed, setExportFailed] = useState(false);
  const [backlinksOpen, setBacklinksOpen] = useState(true);
  const exportRef = useRef<() => void>(() => {});
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setTitle(object?.title ?? "");
    pendingRef.current = null;
    setExportFailed(false);
  }, [object]);

  useEffect(() => {
    if (object === null || title === object.title) {
      pendingRef.current = null;
      return undefined;
    }
    pendingRef.current = title;
    const timer = window.setTimeout(() => {
      pendingRef.current = null;
      void commands.objectUpdateMeta(object.id, { title, icon: null, types: null, archived: null });
    }, TITLE_COMMIT_MS);
    return () => window.clearTimeout(timer);
  }, [title, object]);

  useEffect(() => {
    if (object === null) return undefined;
    const offs = (
      [
        ["editor.exportMarkdown", t("editor.exportMarkdown"), () => exportRef.current()],
        ["editor.toggleBacklinks", t("palette.toggleBacklinks"), () => setBacklinksOpen((o) => !o)],
      ] as const
    ).map(([id, lbl, run]) => registerCommand({ id, title: lbl, run }));
    return () => {
      for (const off of offs) off();
    };
  }, [object, t]);

  const flushTitle = () => {
    const next = pendingRef.current;
    if (next === null || object === null) return;
    pendingRef.current = null;
    void commands.objectUpdateMeta(object.id, {
      title: next,
      icon: null,
      types: null,
      archived: null,
    });
  };

  if (object === null) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2">
        <h2 className="text-lg font-semibold text-[color:var(--fg)]">{t("editor.emptyTitle")}</h2>
        <p className="text-sm text-[color:var(--fg-muted)]">{t("editor.emptyBody")}</p>
      </div>
    );
  }

  const displayTitle =
    object.types.includes("Journal") && title === object.title
      ? formatObjectTitle(object, i18n.language, "")
      : title;

  const exportMarkdown = async () => {
    // Flush first: the export reads the stored title, not the one being typed.
    flushTitle();
    const name = displayTitle.trim() === "" ? t("editor.untitled") : displayTitle;
    setExportFailed(!(await exportObjectMarkdown(object.id, name, object.id)));
  };
  exportRef.current = () => void exportMarkdown();

  return (
    <div className="flex h-full min-w-0">
      <div className="mx-auto flex h-full w-full max-w-2xl flex-1 flex-col gap-4 overflow-y-auto px-6 py-8 in-data-[density=compact]:gap-2.5 in-data-[density=compact]:py-5">
        <div className="flex items-start gap-2">
          <input
            type="text"
            value={displayTitle}
            aria-label={t("editor.titleLabel")}
            placeholder={t("editor.untitled")}
            onChange={(event) => setTitle(event.target.value)}
            onBlur={flushTitle}
            className="min-w-0 flex-1 rounded border-0 bg-transparent px-0 text-3xl font-semibold text-[color:var(--fg)] placeholder:text-[color:var(--fg-muted)] focus-visible:outline-2 focus-visible:outline-[color:var(--accent)]"
          />
          <Button
            variant="secondary"
            className="mt-1.5 shrink-0"
            onClick={() => void exportMarkdown()}
          >
            {t("editor.exportMarkdown")}
          </Button>
          <Button
            variant="secondary"
            className="mt-1.5 shrink-0"
            aria-expanded={backlinksOpen}
            onClick={() => setBacklinksOpen((open) => !open)}
          >
            {t("backlinks.toggle")}
          </Button>
        </div>
        {exportFailed && (
          <p role="alert" className="text-sm text-[color:var(--fg-muted)]">
            {t("editor.exportFailed")}
          </p>
        )}
        <PageFindBar containerRef={bodyRef} />
        <div ref={bodyRef} className="flex flex-1 flex-col">
          {/* key: a new object remounts the body, so its Y.Doc and error state never leak across pages. */}
          <PageBody key={object.id} objectId={object.id} />
        </div>
      </div>
      {backlinksOpen && <PageBacklinksPanel object={object} onSelect={onSelect} />}
    </div>
  );
}
