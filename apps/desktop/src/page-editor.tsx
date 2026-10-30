import { Button } from "@fossil/ui";
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AiChatPanel } from "./ai-panel";
import type { ObjectMeta, SaveStatus } from "./bindings";
import { commands } from "./bindings";
import { exportObjectMarkdown, printObjectPdf } from "./page-export";
import { registerCommand } from "./shell-commands";
import { PageFindBar } from "./shell-search";
import { formatObjectTitle, selectWorkspaceObject } from "./sidebar";
import { usePageScroll } from "./tabs-session";

const PageBody = lazy(() => import("./page-body").then((m) => ({ default: m.PageBody })));
const PageBacklinksPanel = lazy(() =>
  import("./page-editor-backlinks").then((m) => ({ default: m.PageBacklinksPanel })),
);

const TITLE_COMMIT_MS = 400;
const SAVED_STATUS: SaveStatus = { kind: "Saved", failed_seq: null, last_error: null };

export interface PageEditorProps {
  object: ObjectMeta | null;
  onSelect?: ((object: ObjectMeta) => void) | undefined;
  onObjectUpdated?: ((object: ObjectMeta) => void) | undefined;
}

/** Page header (`object_update_meta`, 400 ms debounce + blur), `⋯` actions menu, body and collapsible backlinks/AI panels (#26, #28, #14, #105). */
export function PageEditor({ object, onSelect, onObjectUpdated }: PageEditorProps) {
  const { t, i18n } = useTranslation();
  const pageScroll = usePageScroll(object?.id ?? null);
  const [title, setTitle] = useState(object?.title ?? "");
  const titleRef = useRef(object?.title ?? "");
  titleRef.current = title;
  const lastSavedTitleRef = useRef(object?.title.trim() ?? "");
  const lastObjectIdRef = useRef<string | null>(object?.id ?? null);
  const timerRef = useRef<number | null>(null);
  const inFlightSaveRef = useRef<Promise<void> | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>(SAVED_STATUS);
  const retrySaveRef = useRef<(() => Promise<void>) | null>(null);
  const handleSaveStatus = useCallback((status: SaveStatus, retry: () => Promise<void>) => {
    retrySaveRef.current = retry;
    setSaveStatus(status);
  }, []);
  // A `[[link]]` opens like a backlink: current tab, sidebar selection follows (#137).
  const openLinked = useCallback(
    (target: ObjectMeta) => {
      onSelect?.(target);
      selectWorkspaceObject(target);
    },
    [onSelect],
  );
  const [exportFailed, setExportFailed] = useState(false);
  const [backlinksOpen, setBacklinksOpen] = useState(true);
  const [aiOpen, setAiOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeMenuIndex, setActiveMenuIndex] = useState(0);
  const exportRef = useRef<() => void>(() => {});
  const printRef = useRef<() => void>(() => {});
  const copyLinkRef = useRef<() => void>(() => {});
  const bodyRef = useRef<HTMLDivElement>(null);
  const titleInputRef = useRef<HTMLTextAreaElement>(null);
  const menuContainerRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const menuItemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    if (object === null || saveStatus.kind === "Saved") return undefined;
    const confirmClose = () => window.confirm(t("editor.saveStatus.confirmClose"));
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = t("editor.saveStatus.confirmClose");
    };
    const onClickCapture = (event: MouseEvent) => {
      const btn = (event.target as Element | null)?.closest?.("button");
      if (btn?.getAttribute("aria-label") === t("tabs.close") && !confirmClose()) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    const onKeyCapture = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "w" && !confirmClose()) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    window.addEventListener("click", onClickCapture, true);
    window.addEventListener("keydown", onKeyCapture, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      window.removeEventListener("click", onClickCapture, true);
      window.removeEventListener("keydown", onKeyCapture, true);
    };
  }, [object, saveStatus.kind, t]);

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
      retrySaveRef.current = null;
      setSaveStatus(SAVED_STATUS);
      setExportFailed(false);
      setMenuOpen(false);
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
        ["editor.copyLink", t("editor.copyLink"), () => copyLinkRef.current()],
        ["editor.toggleBacklinks", t("palette.toggleBacklinks"), () => setBacklinksOpen((o) => !o)],
      ] as const
    ).map(([id, lbl, run]) => registerCommand({ id, title: lbl, run }));
    return () => {
      for (const off of offs) off();
    };
  }, [object, t]);

  useEffect(() => {
    if (!menuOpen) return;
    menuItemRefs.current[activeMenuIndex]?.focus();
  }, [menuOpen, activeMenuIndex]);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const onOutsidePointer = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (target && !menuContainerRef.current?.contains(target)) {
        setMenuOpen(false);
        menuButtonRef.current?.focus();
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setMenuOpen(false);
        menuButtonRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onOutsidePointer);
    document.addEventListener("click", onOutsidePointer);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onOutsidePointer);
      document.removeEventListener("click", onOutsidePointer);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  const currentObject =
    object !== null && lastSavedTitleRef.current !== object.title
      ? { ...object, title: lastSavedTitleRef.current }
      : object;
  const displayTitle =
    object !== null &&
    currentObject !== null &&
    object.types.includes("Journal") &&
    title.trim() === lastSavedTitleRef.current
      ? formatObjectTitle(currentObject, i18n.language, "")
      : title;

  // biome-ignore lint/correctness/useExhaustiveDependencies: displayTitle drives the auto-sizing measurement.
  useLayoutEffect(() => {
    const el = titleInputRef.current;
    if (!el) return;
    el.style.height = "auto";
    if (el.scrollHeight > 0) {
      el.style.height = `${el.scrollHeight}px`;
    } else {
      el.style.height = "";
    }
  }, [displayTitle]);

  if (object === null || currentObject === null) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2">
        <h2 className="text-lg font-semibold text-[color:var(--fg)]">{t("editor.emptyTitle")}</h2>
        <p className="text-sm text-[color:var(--fg-muted)]">{t("editor.emptyBody")}</p>
      </div>
    );
  }

  const exportMarkdown = async () => {
    // Flush first: the export reads the stored title, not the one being typed.
    await flushTitle(titleRef.current);
    const name = displayTitle.trim() === "" ? t("editor.untitled") : displayTitle;
    setExportFailed(!(await exportObjectMarkdown(object.id, name, object.id)));
  };
  const copyPageLink = async () => {
    await flushTitle(titleRef.current);
    const raw = (displayTitle.trim() === "" ? t("editor.untitled") : displayTitle).replace(
      /[[\]|#]/g,
      " ",
    );
    const wikilink = `[[${raw.trim()}]]`;
    try {
      await navigator.clipboard?.writeText(wikilink);
    } catch {
      // Clipboard API may be unavailable in restricted contexts.
    }
  };
  exportRef.current = () => void exportMarkdown();
  printRef.current = () => {
    void flushTitle(titleRef.current);
    printObjectPdf();
  };
  copyLinkRef.current = () => void copyPageLink();

  const menuItems = [
    {
      id: "export-markdown",
      label: t("editor.exportMarkdown"),
      run: () => void exportMarkdown(),
    },
    {
      id: "export-pdf",
      label: t("editor.exportPdf"),
      run: () => printRef.current(),
    },
    {
      id: "copy-link",
      label: t("editor.copyLink"),
      run: () => void copyPageLink(),
    },
  ];

  const closeMenu = (restoreFocus: boolean) => {
    setMenuOpen(false);
    if (restoreFocus) {
      menuButtonRef.current?.focus();
    }
  };

  return (
    <div className="flex h-full min-w-0 print:block print:h-auto">
      {/*
        The scroll lives on this full-width wrapper, so the scrollbar sits at
        the window's right edge; the reading column below stays centered
        without scrolling of its own (spec R1.5, r1-scrollbar). The right
        panels stay outside, as siblings of this wrapper.
      */}
      <div
        ref={pageScroll.ref}
        onScroll={pageScroll.onScroll}
        className="flex h-full min-w-0 flex-1 flex-col overflow-y-auto [scrollbar-gutter:stable] print:h-auto print:overflow-visible"
      >
        <div className="mx-auto flex min-h-full w-full max-w-2xl flex-col gap-4 px-6 py-8 in-data-[density=compact]:gap-2.5 in-data-[density=compact]:py-5">
          <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
            <textarea
              ref={titleInputRef}
              rows={1}
              value={displayTitle}
              title={displayTitle || t("editor.untitled")}
              aria-label={t("editor.titleLabel")}
              placeholder={t("editor.untitled")}
              onChange={(event) => {
                const next = event.target.value.replace(/[\r\n]+/g, " ");
                titleRef.current = next;
                setTitle(next);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  event.currentTarget.blur();
                }
              }}
              onBlur={() => void flushTitle(titleRef.current)}
              className="min-w-40 flex-1 resize-none overflow-hidden break-words rounded border-0 bg-transparent px-0 py-0 text-3xl leading-tight font-semibold text-[color:var(--fg)] placeholder:text-[color:var(--fg-muted)] focus-visible:outline-2 focus-visible:outline-[color:var(--accent)] [field-sizing:content]"
            />
            <div className="mt-1 flex min-w-0 max-w-full flex-wrap items-center gap-1.5 print:hidden">
              <output
                data-save-status={saveStatus.kind}
                data-failed-seq={saveStatus.failed_seq ?? undefined}
                title={saveStatus.last_error ?? undefined}
                aria-live="polite"
                className={`inline-flex max-w-full items-center gap-1.5 rounded px-2 py-0.5 text-xs ${saveStatus.kind === "Error" ? "border border-[color:var(--danger)] text-[color:var(--danger)]" : "text-[color:var(--fg-muted)]"}`}
              >
                <span
                  aria-hidden="true"
                  className={`text-[10px] leading-none ${saveStatus.kind === "Saved" ? "text-[color:var(--success)]" : saveStatus.kind === "Saving" ? "text-[color:var(--warning)]" : "text-[color:var(--danger)]"}`}
                >
                  {saveStatus.kind === "Saving" ? "◌" : "●"}
                </span>
                <span>
                  {t(
                    saveStatus.kind === "Saved"
                      ? "editor.saveStatus.saved"
                      : saveStatus.kind === "Saving"
                        ? "editor.saveStatus.saving"
                        : "editor.saveStatus.error",
                  )}
                </span>
                {saveStatus.kind === "Error" && saveStatus.last_error && (
                  <span className="max-w-20 truncate text-[color:var(--fg-muted)]">
                    · {saveStatus.last_error}
                  </span>
                )}
                {saveStatus.kind === "Error" && (
                  <button
                    type="button"
                    onClick={() => void retrySaveRef.current?.()}
                    className="rounded border border-[color:var(--border)] bg-[color:var(--bg-elevated)] px-2 py-0.5 text-xs font-medium text-[color:var(--fg)] hover:bg-[color-mix(in_srgb,var(--accent)_8%,transparent)] focus-visible:outline-2 focus-visible:outline-[color:var(--accent)]"
                  >
                    {t("editor.saveStatus.retry")}
                  </button>
                )}
              </output>
              <Button
                variant="secondary"
                className="shrink-0"
                aria-label={t("backlinks.toggle")}
                aria-expanded={backlinksOpen}
                onClick={() => setBacklinksOpen((open) => !open)}
              >
                {t("backlinks.toggle")}
              </Button>
              <Button
                variant="secondary"
                className="shrink-0"
                aria-label={t("ai.toggle")}
                aria-expanded={aiOpen}
                onClick={() => setAiOpen((open) => !open)}
              >
                {t("ai.toggle")}
              </Button>
              <div ref={menuContainerRef} className="relative">
                <button
                  ref={menuButtonRef}
                  type="button"
                  className="fui-button fui-button--secondary shrink-0 px-2.5"
                  aria-label={t("editor.moreActions")}
                  title={t("editor.moreActions")}
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                  onClick={() => {
                    setActiveMenuIndex(0);
                    setMenuOpen((open) => !open);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " " || event.key === "ArrowDown") {
                      event.preventDefault();
                      setActiveMenuIndex(0);
                      setMenuOpen((open) => !open);
                    } else if (event.key === "ArrowUp") {
                      event.preventDefault();
                      setActiveMenuIndex(menuItems.length - 1);
                      setMenuOpen(true);
                    }
                  }}
                >
                  ⋯
                </button>
                {menuOpen && (
                  <div
                    role="menu"
                    aria-label={t("editor.moreActions")}
                    className="absolute top-full right-0 z-20 mt-1 min-w-48 rounded-md border border-[color:var(--border)] bg-[color:var(--bg-elevated)] p-1 shadow-md"
                  >
                    {menuItems.map((item, index) => (
                      <button
                        key={item.id}
                        ref={(el) => {
                          menuItemRefs.current[index] = el;
                        }}
                        type="button"
                        role="menuitem"
                        aria-label={item.label}
                        tabIndex={index === activeMenuIndex ? 0 : -1}
                        onClick={() => {
                          closeMenu(true);
                          item.run();
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "ArrowDown") {
                            event.preventDefault();
                            setActiveMenuIndex((i) => (i + 1) % menuItems.length);
                          } else if (event.key === "ArrowUp") {
                            event.preventDefault();
                            setActiveMenuIndex(
                              (i) => (i - 1 + menuItems.length) % menuItems.length,
                            );
                          } else if (event.key === "Home") {
                            event.preventDefault();
                            setActiveMenuIndex(0);
                          } else if (event.key === "End") {
                            event.preventDefault();
                            setActiveMenuIndex(menuItems.length - 1);
                          } else if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            event.stopPropagation();
                            closeMenu(true);
                            item.run();
                          }
                        }}
                        className="flex w-full items-center rounded px-3 py-1.5 text-left text-sm text-[color:var(--fg)] hover:bg-[color:var(--bg)] focus-visible:bg-[color:var(--bg)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[color:var(--accent)]"
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
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
            <Suspense fallback={null}>
              <PageBody
                key={object.id}
                objectId={object.id}
                onSaveStatusChange={handleSaveStatus}
                onOpenObject={openLinked}
              />
            </Suspense>
          </div>
        </div>
      </div>
      {backlinksOpen && (
        <div className="contents print:hidden">
          <Suspense fallback={null}>
            <PageBacklinksPanel object={currentObject} onSelect={onSelect} />
          </Suspense>
        </div>
      )}
      {aiOpen && <AiChatPanel key={object.id} object={currentObject} />}
    </div>
  );
}
