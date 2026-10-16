import { AppIcon, Button } from "@fossil/ui";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ObjectId, ObjectMeta } from "./bindings";
import { commands, events } from "./bindings";
import { registerCommand } from "./shell-commands";
import { openPalette, ShellPalette } from "./shell-palette";
import { ShellSearch } from "./shell-search";
import { ShellSettings } from "./shell-settings";
import { errorLabel } from "./vault-screen";

let workspaceOnSelect: ((object: ObjectMeta) => void) | null = null;
export const selectWorkspaceObject = (object: ObjectMeta) => workspaceOnSelect?.(object);

const dateFormatters = new Map<string, Intl.DateTimeFormat>();

function getDateFormatter(language: string): Intl.DateTimeFormat {
  let fmt = dateFormatters.get(language);
  if (fmt === undefined) {
    fmt = new Intl.DateTimeFormat(language, { dateStyle: "long", timeZone: "UTC" });
    dateFormatters.set(language, fmt);
  }
  return fmt;
}

/** Formats ISO `YYYY-MM-DD` journal titles with the active locale. */
export function formatObjectTitle(object: ObjectMeta, language: string, untitled: string): string {
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(object.title);
  if (object.types.includes("Journal") && iso !== null) {
    const date = new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])));
    if (!Number.isNaN(date.getTime())) {
      return getDateFormatter(language).format(date);
    }
  }
  return object.title !== "" ? object.title : untitled;
}

export interface ObjectTreeNode {
  object: ObjectMeta;
  children: ObjectTreeNode[];
}

export function buildObjectTree(objects: ObjectMeta[]): ObjectTreeNode[] {
  const byId = new Map<ObjectId, ObjectTreeNode>();
  for (const object of objects) byId.set(object.id, { object, children: [] });
  const hasCycle = (start: ObjectMeta): boolean => {
    const seen = new Set<ObjectId>([start.id]);
    let cur = start.parent;
    while (cur !== null) {
      if (seen.has(cur)) return true;
      seen.add(cur);
      cur = byId.get(cur)?.object.parent ?? null;
    }
    return false;
  };
  const roots: ObjectTreeNode[] = [];
  for (const node of byId.values()) {
    const parent =
      node.object.parent !== null && !hasCycle(node.object)
        ? byId.get(node.object.parent)
        : undefined;
    if (parent !== undefined) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

function readExpandedMap(vaultName: string): Record<string, boolean> {
  try {
    const raw = window.localStorage.getItem(`fossil.sidebar.expanded:${vaultName}`);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, boolean>;
    }
  } catch {
    // Ignore unavailable or corrupted localStorage.
  }
  return {};
}

function ObjectTypeIcon(props: { object: ObjectMeta; hasChildren: boolean }) {
  const { object, hasChildren } = props;
  if (object.icon !== null) {
    return (
      <span aria-hidden="true" className="shrink-0 text-sm">
        {object.icon}
      </span>
    );
  }
  const isFolder =
    hasChildren ||
    object.types.some(
      (tk) => typeof tk === "object" && ("Builtin" in tk ? tk.Builtin : tk.Custom) === "Folder",
    );
  const kind = object.types.includes("Journal") ? "journal" : isFolder ? "folder" : "page";
  return (
    <svg
      aria-hidden="true"
      data-icon={kind}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-3.5 w-3.5 shrink-0 text-[color:var(--fg-muted)]"
    >
      {kind === "folder" ? (
        <path d="M2 4.5A1.5 1.5 0 0 1 3.5 3h2.6a1 1 0 0 1 .7.3l1.1 1.2h4.6A1.5 1.5 0 0 1 14 6v6a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 12V4.5Z" />
      ) : kind === "journal" ? (
        <path d="M3.5 3.5h9A1 1 0 0 1 13.5 4.5v8a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1ZM5.5 2v2.5M10.5 2v2.5M2.5 6.5h11" />
      ) : (
        <path d="M4 2.5h5.5L12.5 5.5v8a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-10a1 1 0 0 1 1-1ZM9 2.5v3.5h3.5" />
      )}
    </svg>
  );
}

/** Hierarchical sidebar (#26, #31, #107): folder/page tree, drag-and-drop move, expanded persistence, and Ctrl+P switcher. */
export function Sidebar({
  vaultName,
  selectedId,
  onSelect,
}: {
  vaultName: string;
  selectedId: ObjectId | null;
  onSelect: (object: ObjectMeta) => void;
}) {
  const { t, i18n } = useTranslation();
  const [objects, setObjects] = useState<ObjectMeta[] | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [expandedMap, setExpandedMap] = useState<Record<string, boolean>>(() =>
    readExpandedMap(vaultName),
  );
  const [draggedId, setDraggedId] = useState<ObjectId | null>(null);
  const [dropTarget, setDropTarget] = useState<ObjectId | "root" | null>(null);
  workspaceOnSelect = onSelect;

  useEffect(() => {
    setExpandedMap(readExpandedMap(vaultName));
  }, [vaultName]);

  const setNodeExpanded = (id: ObjectId, nextExpanded: boolean) => {
    setExpandedMap((prev) => {
      const next = { ...prev, [id]: nextExpanded };
      try {
        window.localStorage.setItem(`fossil.sidebar.expanded:${vaultName}`, JSON.stringify(next));
      } catch {
        // Ignore storage quota errors.
      }
      return next;
    });
  };

  const refresh = useCallback(() => {
    void commands
      .objectList({ include_archived: false, type_key: null, parent: null, query: null })
      .then((res) => setObjects(res.status === "ok" ? res.data : []));
  }, []);

  useEffect(() => {
    refresh();
    let alive = true;
    const onEvent = () => {
      if (alive) refresh();
    };
    const off = events.objectChanged.listen(onEvent);
    return () => {
      alive = false;
      void off.then((fn) => fn());
    };
  }, [refresh]);

  const runAction = async (
    call: () => ReturnType<typeof commands.journalToday>,
    selectResult = true,
  ) => {
    try {
      const res = await call();
      if (res.status === "ok") {
        setActionError(null);
        if (selectResult) onSelect(res.data);
        refresh();
        return;
      }
      setActionError(
        res.error === "NotImplemented"
          ? t("error.notImplemented")
          : t("error.generic", { error: errorLabel(res.error) }),
      );
    } catch (error) {
      setActionError(t("error.generic", { error: errorLabel(error) }));
    }
  };

  const runRef = useRef(runAction);
  runRef.current = runAction;
  useEffect(() => {
    const newPage = { types: ["Page" as const], title: "", icon: null, parent: null };
    const offs = (
      [
        [
          "shell.newPage",
          t("sidebar.newPage"),
          () => runRef.current(() => commands.objectCreate(newPage)),
        ],
        ["shell.today", t("sidebar.today"), () => runRef.current(() => commands.journalToday())],
        ["shell.search", t("search.open"), () => setSearchOpen(true)],
        ["shell.capture", t("settings.shortcutCapture"), () => void commands.captureWindowShow()],
        ["shell.settings", t("sidebar.settings"), () => setSettingsOpen(true)],
      ] as const
    ).map(([id, title, run]) => registerCommand({ id, title, run }));
    return () => {
      for (const off of offs) off();
    };
  }, [t]);

  const renderNode = (node: ObjectTreeNode) => {
    const { object, children } = node;
    const hasChildren = children.length > 0;
    const isExpanded = expandedMap[object.id] ?? true;
    const isActive = object.id === selectedId;
    const isDrop = dropTarget === object.id;
    const label = formatObjectTitle(object, i18n.language, t("editor.untitled"));

    return (
      <li
        key={object.id}
        className="flex flex-col gap-0.5 [content-visibility:auto] [contain-intrinsic-size:0_2.25rem]"
      >
        <div className="flex items-center gap-0.5">
          {hasChildren && (
            <button
              type="button"
              aria-expanded={isExpanded}
              aria-label={t(isExpanded ? "sidebar.collapse" : "sidebar.expand", { title: label })}
              onClick={() => setNodeExpanded(object.id, !isExpanded)}
              className="flex h-6 w-5 shrink-0 items-center justify-center rounded text-[color:var(--fg-muted)] hover:bg-[color-mix(in_srgb,var(--accent)_8%,transparent)] hover:text-[color:var(--fg)] focus-visible:outline-2 focus-visible:outline-[color:var(--accent)]"
            >
              <svg
                aria-hidden="true"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
                className={`h-3 w-3 transition-transform duration-150 ease-out ${isExpanded ? "rotate-90" : ""}`}
              >
                <path d="M6 4l4 4-4 4" />
              </svg>
            </button>
          )}
          <button
            type="button"
            draggable
            onClick={() => onSelect(object)}
            onDragStart={(e) => {
              setDraggedId(object.id);
              e.dataTransfer?.setData("text/plain", object.id);
            }}
            onDragEnd={() => {
              setDraggedId(null);
              setDropTarget(null);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (draggedId !== object.id) setDropTarget(object.id);
            }}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              const src = draggedId ?? (e.dataTransfer?.getData("text/plain") || null);
              setDraggedId(null);
              setDropTarget(null);
              if (src && src !== object.id) {
                setNodeExpanded(object.id, true);
                void runAction(() => commands.objectMove(src, object.id), false);
              }
            }}
            aria-current={isActive ? "page" : undefined}
            data-drop-target={isDrop ? "true" : undefined}
            className="flex min-w-0 flex-1 items-center gap-2 rounded border border-transparent px-2.5 py-1.5 text-left text-sm transition-colors duration-150 ease-out hover:bg-[color-mix(in_srgb,var(--accent)_6%,transparent)] focus-visible:outline-2 focus-visible:outline-[color:var(--accent)] aria-[current=page]:border-[color:var(--border)] aria-[current=page]:bg-[color-mix(in_srgb,var(--accent)_10%,var(--bg-elevated))] aria-[current=page]:font-semibold aria-[current=page]:shadow-[inset_3px_0_0_var(--accent)] data-[drop-target=true]:border-[color:var(--accent)] data-[drop-target=true]:bg-[color-mix(in_srgb,var(--accent)_12%,var(--bg-elevated))] in-data-[density=compact]:py-1 in-data-[density=compact]:text-xs"
          >
            <ObjectTypeIcon object={object} hasChildren={hasChildren} />
            <span className="truncate text-[color:var(--fg)]">{label}</span>
          </button>
        </div>
        {hasChildren && isExpanded && (
          <ul className="ml-3 flex flex-col gap-0.5 border-l border-[color:var(--border)] pl-1.5">
            {children.map(renderNode)}
          </ul>
        )}
      </li>
    );
  };

  const treeRoots = objects !== null ? buildObjectTree(objects) : [];

  return (
    <aside className="flex print:hidden h-dvh w-64 shrink-0 flex-col gap-4 border-r border-[color:var(--border)] px-3 py-4 in-data-[density=compact]:gap-2.5 in-data-[density=compact]:py-3">
      <header className="flex items-center gap-2 px-2">
        <AppIcon />
        <div className="flex min-w-0 flex-col">
          <span className="text-sm font-semibold tracking-tight text-[color:var(--fg)]">
            {t("app.name")}
          </span>
          <span className="truncate text-xs text-[color:var(--fg-muted)]">{vaultName}</span>
        </div>
      </header>

      <div className="flex flex-col gap-1">
        <button
          type="button"
          onClick={() => openPalette("switcher")}
          className="flex w-full items-center justify-between gap-2 rounded border border-[color:var(--border)] bg-[color:var(--bg-elevated)] px-2.5 py-1.5 text-left text-xs text-[color:var(--fg-muted)] transition-colors duration-150 ease-out hover:border-[color:var(--accent)] hover:text-[color:var(--fg)] focus-visible:outline-2 focus-visible:outline-[color:var(--accent)]"
        >
          <span className="truncate">{t("sidebar.quickOpen")}</span>
          <kbd className="rounded border border-[color:var(--border)] bg-[color:var(--bg)] px-1.5 py-0.5 font-mono text-[10px] text-[color:var(--fg-muted)]">
            {t("sidebar.quickOpenShortcut")}
          </kbd>
        </button>
        <Button
          onClick={() =>
            void runAction(() =>
              commands.objectCreate({ types: ["Page"], title: "", icon: null, parent: null }),
            )
          }
        >
          {t("sidebar.newPage")}
        </Button>
        <Button variant="secondary" onClick={() => void runAction(() => commands.journalToday())}>
          {t("sidebar.today")}
        </Button>
        <Button variant="secondary" onClick={() => setSearchOpen(true)}>
          {t("search.open")}
        </Button>
      </div>

      {actionError !== null && (
        <p role="alert" className="text-sm text-[color:var(--danger)]">
          {actionError}
        </p>
      )}

      <nav aria-label={t("sidebar.label")} className="flex min-h-0 flex-1 flex-col gap-2">
        <h2 className="px-2 text-xs font-medium uppercase tracking-wide text-[color:var(--fg-muted)]">
          {t("sidebar.label")}
        </h2>
        {objects === null || objects.length === 0 ? (
          <p className="px-2 text-sm text-[color:var(--fg-muted)]">
            {t(objects === null ? "sidebar.loading" : "sidebar.empty")}
          </p>
        ) : (
          <ul
            data-testid="sidebar-tree-root"
            data-drop-target={dropTarget === "root" ? "true" : undefined}
            onDragOver={(e) => {
              e.preventDefault();
              setDropTarget("root");
            }}
            onDragLeave={(e) => {
              if (e.currentTarget === e.target) setDropTarget(null);
            }}
            onDrop={(e) => {
              e.preventDefault();
              const src = draggedId ?? (e.dataTransfer?.getData("text/plain") || null);
              setDraggedId(null);
              setDropTarget(null);
              if (src) void runAction(() => commands.objectMove(src, null), false);
            }}
            className="flex flex-1 flex-col gap-1 overflow-y-auto rounded border border-transparent data-[drop-target=true]:border-[color:var(--accent)] in-data-[density=compact]:gap-0.5"
          >
            {treeRoots.map(renderNode)}
          </ul>
        )}
      </nav>

      <Button variant="secondary" onClick={() => setSettingsOpen(true)}>
        {t("sidebar.settings")}
      </Button>
      <ShellSettings
        open={settingsOpen}
        vaultName={vaultName}
        onClose={() => setSettingsOpen(false)}
      />
      <ShellSearch open={searchOpen} onClose={() => setSearchOpen(false)} onSelect={onSelect} />
      <ShellPalette onSelect={onSelect} />
    </aside>
  );
}
