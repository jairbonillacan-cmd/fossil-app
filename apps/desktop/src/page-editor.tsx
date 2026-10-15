import { Button } from "@fossil/ui";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AiChatPanel } from "./ai-panel";
import type { ObjectMeta } from "./bindings";
import { commands } from "./bindings";
import { PageBody } from "./page-body";
import { PageBacklinksPanel } from "./page-editor-backlinks";
import { exportObjectMarkdown, printObjectPdf } from "./page-export";
import { registerCommand } from "./shell-commands";
import { PageFindBar } from "./shell-search";
import { formatObjectTitle, selectWorkspaceObject } from "./sidebar";

const TITLE_COMMIT_MS = 400;

export interface PageEditorProps {
  object: ObjectMeta | null;
  onSelect?: ((object: ObjectMeta) => void) | undefined;
  onObjectUpdated?: ((object: ObjectMeta) => void) | undefined;
}

/** Page header (`object_update_meta`, 400 ms debounce + blur), body and collapsible backlinks/AI panels (#26, #28, #14). */
export function PageEditor({ object, onSelect, onObjectUpdated }: PageEditorProps) {
  const { t, i18n } = useTranslation();
  const [title, setTitle] = useState(object?.title ?? "");
  const titleRef = useRef(object?.title ?? "");
  titleRef.current = title;
  const lastSavedTitleRef = useRef(object?.title.trim() ?? "");
  const lastObjectIdRef = useRef<string | null>(object?.id ?? null);
  const timerRef = useRef<number | null>(null);
  const inFlightSaveRef = useRef<Promise<void> | null>(null);
  const [exportFailed, setExportFailed] = useState(false);
  const [backlinksOpen, setBacklinksOpen] = useState(true);
  const [aiOpen, setAiOpen] = useState(false);
  const exportRef = useRef<() => void>(() => {});
  const printRef = useRef<() => void>(() => {});
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const nextId = object?.id ?? null;
    if (lastObjectIdRef.current !== nextId) {
      lastObjectIdRef.current = nextId;
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      const initialTitle = object?.title ?? "";
      setTitle(initialTitle);
      titleRef.current = initialTitle;
      lastSavedTitleRef.current = initialTitle.trim();
      inFlightSaveRef.current = null;
      setExportFailed(false);
    } else if (
      object !== null &&
      timerRef.current === null &&
      inFlightSaveRef.current === null &&
      titleRef.current.trim() === lastSavedTitleRef.current &&
      object.title.trim() !== lastSavedTitleRef.current
    ) {
      setTitle(object.title);
      titleRef.current = object.title;
      lastSavedTitleRef.current = object.title.trim();
    }
  }, [object]);

  const flushTitle = (candidate = titleRef.current): Promise<void> => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const trimmed = candidate.trim();
    if (object === null || trimmed === lastSavedTitleRef.current) {
      return inFlightSaveRef.current ?? Promise.resolve();
    }
    const prevSaved = lastSavedTitleRef.current;
    lastSavedTitleRef.current = trimmed;
    const targetObject = object;
    const prevInFlight = inFlightSaveRef.current;
    const saveCall = Promise.resolve(
      commands.objectUpdateMeta(targetObject.id, {
        title: trimmed,
        icon: null,
        types: null,
        archived: null,
      }),
    ).then((res) => {
      if (res && res.status === "error") {
        if (lastSavedTitleRef.current === trimmed) {
          lastSavedTitleRef.current = prevSaved;
        }
        return;
      }
      const updated =
        res?.status === "ok" && res.data ? res.data : { ...targetObject, title: trimmed };
      onObjectUpdated?.(updated);
      selectWorkspaceObject(updated);
    });
    const tracked = (
      prevInFlight ? Promise.all([prevInFlight, saveCall]).then(() => undefined) : saveCall
    ).finally(() => {
      if (inFlightSaveRef.current === tracked) {
        inFlightSaveRef.current = null;
      }
    });
    inFlightSaveRef.current = tracked;
    return tracked;
  };

  const flushRef = useRef(flushTitle);
  flushRef.current = flushTitle;

  useEffect(() => {
    if (object === null || title.trim() === lastSavedTitleRef.current) {
      return undefined;
    }
    const timer = window.setTimeout(() => {
      timerRef.current = null;
      void flushRef.current(title);
    }, TITLE_COMMIT_MS);
    timerRef.current = timer;
    return () => {
      window.clearTimeout(timer);
      if (timerRef.current === timer) {
        timerRef.current = null;
      }
    };
  }, [title, object]);

  useEffect(() => {
    if (object === null) return undefined;
    const offs = (
      [
        ["editor.exportMarkdown", t("editor.exportMarkdown"), () => exportRef.current()],
        ["editor.exportPdf", t("editor.exportPdf"), () => printRef.current()],
        ["editor.toggleBacklinks", t("palette.toggleBacklinks"), () => setBacklinksOpen((o) => !o)],
      ] as const
    ).map(([id, lbl, run]) => registerCommand({ id, title: lbl, run }));
    return () => {
      for (const off of offs) off();
    };
  }, [object, t]);

  if (object === null) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2">
        <h2 className="text-lg font-semibold text-[color:var(--fg)]">{t("editor.emptyTitle")}</h2>
        <p className="text-sm text-[color:var(--fg-muted)]">{t("editor.emptyBody")}</p>
      </div>
    );
  }

  const currentObject =
    lastSavedTitleRef.current !== object.title
      ? { ...object, title: lastSavedTitleRef.current }
      : object;
  const displayTitle =
    object.types.includes("Journal") && title.trim() === lastSavedTitleRef.current
      ? formatObjectTitle(currentObject, i18n.language, "")
      : title;

  const exportMarkdown = async () => {
    // Flush first: the export reads the stored title, not the one being typed.
    await flushTitle(titleRef.current);
    const name = displayTitle.trim() === "" ? t("editor.untitled") : displayTitle;
    setExportFailed(!(await exportObjectMarkdown(object.id, name, object.id)));
  };
  exportRef.current = () => void exportMarkdown();
  printRef.current = () => {
    void flushTitle(titleRef.current);
    printObjectPdf();
  };

  return (
    <div className="flex h-full min-w-0 print:block print:h-auto">
      <div className="mx-auto flex h-full w-full max-w-2xl flex-1 flex-col gap-4 overflow-y-auto px-6 print:h-auto print:overflow-visible py-8 in-data-[density=compact]:gap-2.5 in-data-[density=compact]:py-5">
        <div className="flex items-start gap-2">
          <input
            type="text"
            value={displayTitle}
            aria-label={t("editor.titleLabel")}
            placeholder={t("editor.untitled")}
            onChange={(event) => {
              titleRef.current = event.target.value;
              setTitle(event.target.value);
            }}
            onBlur={() => void flushTitle(titleRef.current)}
            className="min-w-0 flex-1 rounded border-0 bg-transparent px-0 text-3xl font-semibold text-[color:var(--fg)] placeholder:text-[color:var(--fg-muted)] focus-visible:outline-2 focus-visible:outline-[color:var(--accent)]"
          />
          <Button
            variant="secondary"
            className="mt-1.5 shrink-0 print:hidden"
            onClick={() => void exportMarkdown()}
          >
            {t("editor.exportMarkdown")}
          </Button>
          <Button
            variant="secondary"
            className="mt-1.5 shrink-0 print:hidden"
            onClick={() => printRef.current()}
          >
            {t("editor.exportPdf")}
          </Button>
          <Button
            variant="secondary"
            className="mt-1.5 shrink-0 print:hidden"
            aria-expanded={backlinksOpen}
            onClick={() => setBacklinksOpen((open) => !open)}
          >
            {t("backlinks.toggle")}
          </Button>
          <Button
            variant="secondary"
            className="mt-1.5 shrink-0"
            aria-expanded={aiOpen}
            onClick={() => setAiOpen((open) => !open)}
          >
            {t("ai.toggle")}
          </Button>
        </div>
        {exportFailed && (
          <p role="alert" className="text-sm text-[color:var(--fg-muted)] print:hidden">
            {t("editor.exportFailed")}
          </p>
        )}
        <div className="contents print:hidden">
          <PageFindBar containerRef={bodyRef} />
        </div>
        <div ref={bodyRef} className="flex flex-1 flex-col">
          {/* key: a new object remounts the body, so its Y.Doc and error state never leak across pages. */}
          <PageBody key={object.id} objectId={object.id} />
        </div>
      </div>
      {backlinksOpen && (
        <div className="contents print:hidden">
          <PageBacklinksPanel object={currentObject} onSelect={onSelect} />
        </div>
      )}
      {aiOpen && <AiChatPanel key={object.id} object={currentObject} />}
    </div>
  );
}
