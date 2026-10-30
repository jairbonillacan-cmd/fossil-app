import {
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { commands, events, type ObjectMeta } from "./bindings";
import { formatObjectTitle } from "./sidebar";
import {
  getScrollOffsets,
  loadSession,
  registerScrollFlush,
  restoreSession,
  SESSION_VERSION,
  saveSession,
  setScrollOffsets,
  type TabsSession,
  trimScroll,
} from "./tabs-session";

export interface WorkspaceTab {
  id: string;
  object: ObjectMeta | null;
  pinned: boolean;
  /** Pages this tab visited (own Back/Forward history, #173) and the index of the one shown. */
  history: ObjectMeta[];
  historyIndex: number;
}

export type WorkspacePane = "main" | "split";

interface TabsState {
  tabs: WorkspaceTab[];
  activeTabId: string | null;
  /** Second pane beside the tabs (#166): its own page and Back/Forward history. */
  split: WorkspaceTab | null;
  /** Pane that receives navigation (sidebar, palette, links, Back/Forward). */
  focus: WorkspacePane;
  /** Recently closed tabs, newest last, for Ctrl+Shift+T (kept in memory only). */
  closed: Array<{ tab: WorkspaceTab; index: number }>;
}

const MAX_CLOSED_TABS = 20;

const MAX_TAB_HISTORY = 100;

let nextTabSeq = 1;
const mkTab = (object: ObjectMeta | null): WorkspaceTab => ({
  id: `tab-${nextTabSeq++}`,
  object,
  pinned: false,
  history: object ? [object] : [],
  historyIndex: object ? 0 : -1,
});

const toSessionTab = (t: WorkspaceTab) => ({
  objectId: t.object?.id ?? null,
  pinned: t.pinned,
  history: t.history.map((o) => o.id),
  historyIndex: t.historyIndex,
});

const toSession = (s: TabsState): TabsSession => {
  const idx = s.tabs.findIndex((t) => t.id === s.activeTabId);
  const tabs = s.tabs.map(toSessionTab);
  const split = s.split ? toSessionTab(s.split) : null;
  return {
    v: SESSION_VERSION,
    tabs,
    active: idx === -1 ? null : idx,
    ...(split ? { split } : {}),
    scroll: trimScroll(getScrollOffsets(), split ? [...tabs, split] : tabs),
  };
};

/** Shows `target` in `tab`, pushing it on the tab's own history (drops the forward branch). */
const navigateTab = (tab: WorkspaceTab, target: ObjectMeta): WorkspaceTab => {
  const history = [...tab.history.slice(0, tab.historyIndex + 1), target].slice(-MAX_TAB_HISTORY);
  return { ...tab, object: target, history, historyIndex: history.length - 1 };
};
const refreshTab = (tab: WorkspaceTab, u: ObjectMeta): WorkspaceTab => ({
  ...tab,
  object: tab.object?.id === u.id ? u : tab.object,
  history: tab.history.map((x) => (x.id === u.id ? u : x)),
});

/**
 * State hook for workspace tabs: pin/close/reorder and a Back/Forward history per tab (#106, #173).
 * With `vaultName`, the session (tabs, order, pins, active tab, per-tab history and scroll) is
 * restored on mount and saved per Espacio in localStorage (#29).
 */
export function useWorkspaceTabs(
  initialTabs: WorkspaceTab[] = [],
  vaultName: string | null = null,
) {
  const [s, setS] = useState<TabsState>(() => ({
    tabs: initialTabs,
    activeTabId: initialTabs[0]?.id ?? null,
    split: null,
    focus: "main",
    closed: [],
  }));
  const activeTab = s.tabs.find((t) => t.id === s.activeTabId) ?? null;
  const focusedTab = s.focus === "split" && s.split ? s.split : activeTab;
  const hydrated = useRef(false);
  const latestState = useRef(s);
  latestState.current = s;

  useEffect(() => {
    hydrated.current = false;
    if (vaultName === null) return undefined;
    let cancelled = false;
    let loading = false;
    const saved = loadSession(vaultName);
    setScrollOffsets(saved?.scroll ?? {});
    const finish = (restore: ReturnType<typeof restoreSession> | null) => {
      if (cancelled) return;
      if (restore && restore.tabs.length > 0) {
        const tabs = restore.tabs.map((x) => ({ ...mkTab(x.object), ...x }));
        const activeTabId = tabs[restore.active ?? -1]?.id ?? null;
        const split = restore.split ? { ...mkTab(restore.split.object), ...restore.split } : null;
        // Opening a page before object_list answers discards the restore (see ui.md).
        setS((prev) =>
          prev.tabs.length > 0 ? prev : { tabs, activeTabId, split, focus: "main", closed: [] },
        );
      }
      hydrated.current = true;
    };
    const load = (session: NonNullable<typeof saved>) => {
      if (loading || hydrated.current) return;
      loading = true;
      void commands
        .objectList({ include_archived: false, type_key: null, parent: null, query: null })
        // On failure keep the saved session untouched and retry on the next object:changed.
        .then((res) => res.status === "ok" && finish(restoreSession(session, res.data)))
        .catch(() => undefined)
        .finally(() => {
          loading = false;
        });
    };
    let off: Promise<() => void> | null = null;
    if (saved) {
      load(saved);
      off = events.objectChanged.listen(() => load(saved));
    } else {
      finish(null);
    }
    return () => {
      cancelled = true;
      void off?.then((fn) => fn());
    };
  }, [vaultName]);

  useEffect(() => {
    if (vaultName === null || !hydrated.current) return;
    saveSession(vaultName, toSession(s));
  }, [s, vaultName]);

  useEffect(() => {
    if (vaultName === null) return undefined;
    const flush = () => {
      if (hydrated.current) saveSession(vaultName, toSession(latestState.current));
    };
    registerScrollFlush(flush);
    window.addEventListener("pagehide", flush);
    return () => {
      flush();
      registerScrollFlush(null);
      window.removeEventListener("pagehide", flush);
    };
  }, [vaultName]);

  const stepHistory = (delta: -1 | 1) =>
    setS((prev) => {
      const inSplit = prev.focus === "split" && prev.split !== null;
      const cur = inSplit ? prev.split : prev.tabs.find((t) => t.id === prev.activeTabId);
      if (!cur) return prev;
      const historyIndex = cur.historyIndex + delta;
      const target = cur.history[historyIndex];
      if (!target) return prev;
      const moved = { ...cur, object: target, historyIndex };
      if (inSplit) return { ...prev, split: moved };
      return { ...prev, tabs: prev.tabs.map((t) => (t.id === cur.id ? moved : t)) };
    });

  return {
    tabs: s.tabs,
    activeTabId: s.activeTabId,
    selectedObject: activeTab?.object ?? null,
    splitOpen: s.split !== null,
    splitObject: s.split?.object ?? null,
    focusedPane: s.split ? s.focus : ("main" as WorkspacePane),
    canGoBack: (focusedTab?.historyIndex ?? 0) > 0,
    canGoForward: !!focusedTab && focusedTab.historyIndex < focusedTab.history.length - 1,
    /**
     * Opens a page in the focused pane. In the tabs: focuses its tab if open, else navigates the
     * active unpinned tab, else a new tab.
     */
    selectObject: (target: ObjectMeta) =>
      setS((prev) => {
        if (prev.focus === "split" && prev.split) {
          const sp = prev.split;
          return {
            ...prev,
            split: sp.object?.id === target.id ? refreshTab(sp, target) : navigateTab(sp, target),
          };
        }
        const cur = prev.tabs.find((t) => t.id === prev.activeTabId) ?? null;
        const put = (id: string, fn: (t: WorkspaceTab) => WorkspaceTab) =>
          prev.tabs.map((t) => (t.id === id ? fn(t) : t));
        if (cur?.object?.id === target.id)
          return { ...prev, tabs: put(cur.id, (t) => refreshTab(t, target)) };
        if (cur && cur.object === null)
          return { ...prev, tabs: put(cur.id, (t) => navigateTab(t, target)) };
        const hit = prev.tabs.find((t) => t.object?.id === target.id);
        if (hit)
          return { ...prev, tabs: put(hit.id, (t) => refreshTab(t, target)), activeTabId: hit.id };
        if (cur && !cur.pinned)
          return { ...prev, tabs: put(cur.id, (t) => navigateTab(t, target)) };
        const nt = mkTab(target);
        return { ...prev, tabs: [...prev.tabs, nt], activeTabId: nt.id };
      }),
    updateObject: (u: ObjectMeta) =>
      setS((prev) => ({
        ...prev,
        tabs: prev.tabs.map((t) => refreshTab(t, u)),
        split: prev.split ? refreshTab(prev.split, u) : null,
        // Closed tabs too, so Ctrl+Shift+T never brings back a stale title.
        closed: prev.closed.map((c) => ({ ...c, tab: refreshTab(c.tab, u) })),
      })),
    /** Splits the work area: the second pane starts on the page shown in the tabs (#166). */
    onSplit: () =>
      setS((prev) => {
        if (prev.split) return { ...prev, focus: "split" };
        const cur = prev.tabs.find((t) => t.id === prev.activeTabId);
        return { ...prev, split: mkTab(cur?.object ?? null), focus: "split" };
      }),
    onCloseSplit: () => setS((prev) => ({ ...prev, split: null, focus: "main" })),
    onFocusPane: (pane: WorkspacePane) =>
      setS((prev) => (prev.focus === pane || !prev.split ? prev : { ...prev, focus: pane })),
    onActivateTab: (tabId: string) =>
      setS((prev) =>
        (prev.activeTabId === tabId && prev.focus === "main") ||
        !prev.tabs.some((x) => x.id === tabId)
          ? prev
          : { ...prev, activeTabId: tabId, focus: "main" },
      ),
    onOpenNewTab: () =>
      setS((prev) => {
        const nt = mkTab(null);
        return { ...prev, tabs: [...prev.tabs, nt], activeTabId: nt.id, focus: "main" };
      }),
    onTogglePinTab: (tabId: string) =>
      setS((prev) => ({
        ...prev,
        tabs: prev.tabs.map((t) => (t.id === tabId ? { ...t, pinned: !t.pinned } : t)),
      })),
    onCloseTab: (tabId: string) =>
      setS((prev) => {
        const idx = prev.tabs.findIndex((t) => t.id === tabId);
        if (idx === -1 || !prev.tabs[idx] || prev.tabs[idx].pinned) return prev;
        const tabs = prev.tabs.filter((t) => t.id !== tabId);
        const activeTabId =
          prev.activeTabId === tabId
            ? (tabs[idx]?.id ?? tabs[idx - 1]?.id ?? null)
            : prev.activeTabId;
        const closed = [...prev.closed, { tab: prev.tabs[idx], index: idx }].slice(
          -MAX_CLOSED_TABS,
        );
        return { ...prev, tabs, activeTabId, closed };
      }),
    /** Reopens the last closed tab where it was, with its history (Ctrl+Shift+T). */
    onReopenClosedTab: () =>
      setS((prev) => {
        const last = prev.closed.at(-1);
        if (!last) return prev;
        const tab = { ...last.tab, id: mkTab(null).id };
        const tabs = [...prev.tabs];
        tabs.splice(Math.min(last.index, tabs.length), 0, tab);
        return {
          ...prev,
          tabs,
          activeTabId: tab.id,
          focus: "main",
          closed: prev.closed.slice(0, -1),
        };
      }),
    onReorderTab: (from: number, to: number) =>
      setS((prev) => {
        if (from === to || from < 0 || to < 0 || from >= prev.tabs.length || to >= prev.tabs.length)
          return prev;
        const tabs = [...prev.tabs];
        const [moved] = tabs.splice(from, 1);
        if (moved) tabs.splice(to, 0, moved);
        return { ...prev, tabs };
      }),
    onGoBack: () => stepHistory(-1),
    onGoForward: () => stepHistory(1),
  };
}

export type ShellTabsProps = Omit<
  ReturnType<typeof useWorkspaceTabs>,
  "selectedObject" | "selectObject" | "updateObject" | "splitOpen" | "splitObject" | "onFocusPane"
>;

const renderBtn = (
  l: string,
  onClick: () => void,
  txt: string,
  className: string,
  disabled?: boolean,
  pr?: boolean,
) => (
  <button
    {...Object.assign(
      { type: "button" as const, title: l, onClick, className, disabled },
      { "aria-label": l, "aria-pressed": pr },
    )}
  >
    {txt}
  </button>
);
const navCls = "fui-button fui-button--secondary px-2 py-1 text-xs disabled:opacity-40";
const newCls = "fui-button fui-button--secondary shrink-0 px-2.5 py-1 text-xs";
const iconCls =
  "shrink-0 rounded px-1 py-0.5 text-[11px] leading-none transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-[color:var(--accent)]";
const closeCls = `${iconCls} text-[color:var(--fg-muted)] hover:text-[color:var(--fg)] disabled:pointer-events-none disabled:opacity-25`;
const badgeCls =
  "shrink-0 rounded border border-[color:var(--border)] px-1 font-mono text-[10px] leading-tight text-[color:var(--fg)]";
const badgeEl = (
  <span aria-hidden="true" className={badgeCls}>
    ●
  </span>
);
const tabBtnCls =
  "flex min-w-0 flex-1 items-center gap-1.5 truncate text-left focus-visible:outline-2 focus-visible:outline-[color:var(--accent)]";

/** Workspace tab bar with pin, close, drag/keyboard reorder, overflow scroll, `+` and back/forward (#106). */
export function ShellTabs(p: ShellTabsProps) {
  const { t, i18n } = useTranslation();
  const [drag, setDrag] = useState<[number, number] | null>(null);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const latest = useRef(p);
  latest.current = p;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const cur = latest.current;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.shiftKey && e.key.toLowerCase() === "t") {
        e.preventDefault();
        cur.onReopenClosedTab();
      } else if (mod && !e.shiftKey && !e.altKey && /^[1-9]$/.test(e.key) && cur.tabs.length > 0) {
        // Ctrl+1..8 jumps to that tab; Ctrl+9 always to the last one.
        e.preventDefault();
        const n = Number(e.key);
        const target = n === 9 ? cur.tabs.at(-1) : cur.tabs[n - 1];
        if (target) cur.onActivateTab(target.id);
      } else if (mod && e.key === "\\") {
        e.preventDefault();
        cur.onSplit();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "w") {
        e.preventDefault();
        // In the second pane, Ctrl+W closes the pane, never a tab it cannot see (#166).
        if (cur.focusedPane === "split") return cur.onCloseSplit();
        const active = cur.tabs.find((x) => x.id === cur.activeTabId);
        if (active && !active.pinned) cur.onCloseTab(active.id);
      } else if (e.ctrlKey && e.key === "Tab" && cur.tabs.length > 1) {
        e.preventDefault();
        const idx = cur.tabs.findIndex((x) => x.id === cur.activeTabId);
        const next =
          cur.tabs[
            ((idx === -1 ? 0 : idx) + (e.shiftKey ? -1 : 1) + cur.tabs.length) % cur.tabs.length
          ];
        if (next) cur.onActivateTab(next.id);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    const idx = p.tabs.findIndex((x) => x.id === p.activeTabId);
    if (idx !== -1) tabRefs.current[idx]?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [p.activeTabId, p.tabs]);

  const onTabKey = (i: number, e: ReactKeyEvent<HTMLButtonElement>) => {
    const dir = e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : 0;
    if (!dir) return;
    if ((e.ctrlKey || e.altKey) && e.shiftKey) {
      if (i + dir >= 0 && i + dir < p.tabs.length) {
        e.preventDefault();
        p.onReorderTab(i, i + dir);
        tabRefs.current[i + dir]?.focus();
      }
    } else {
      e.preventDefault();
      const nextIdx = (i + dir + p.tabs.length) % p.tabs.length;
      if (p.tabs[nextIdx]) p.onActivateTab(p.tabs[nextIdx].id);
      tabRefs.current[nextIdx]?.focus();
    }
  };

  const rowProps = (tab: WorkspaceTab, i: number, isDrop: boolean, isActive: boolean) => ({
    "data-tab-id": tab.id,
    "data-pinned": String(tab.pinned),
    "data-drop-target": isDrop ? "true" : undefined,
    draggable: true,
    onDragStart: () => setDrag([i, i]),
    onDragOver: (e: ReactDragEvent) => {
      e.preventDefault();
      if (drag && drag[1] !== i) setDrag([drag[0], i]);
    },
    onDrop: (e: ReactDragEvent) => {
      e.preventDefault();
      if (drag && drag[0] !== i) p.onReorderTab(drag[0], i);
      setDrag(null);
    },
    onDragEnd: () => setDrag(null),
    className: `group flex min-w-[7.5rem] max-w-[12.5rem] shrink-0 items-center gap-1 rounded border px-2 py-1 text-xs transition-colors duration-150 ${isActive ? "border-[color:var(--accent)] bg-[color:var(--bg)] font-semibold text-[color:var(--fg)]" : "border-[color:var(--border)] bg-transparent text-[color:var(--fg-muted)] hover:bg-[color:var(--bg)] hover:text-[color:var(--fg)]"} ${tab.pinned ? "border-l-2 border-l-[color:var(--accent)]" : ""} ${isDrop ? "ring-2 ring-[color:var(--accent)]" : ""}`,
  });

  const itemProps = (tab: WorkspaceTab, i: number, label: string, isActive: boolean) => ({
    ref: (el: HTMLButtonElement | null) => {
      tabRefs.current[i] = el;
    },
    type: "button" as const,
    role: "tab" as const,
    "aria-selected": isActive,
    "aria-label": label,
    title: label,
    tabIndex: isActive || (p.activeTabId === null && i === 0) ? 0 : -1,
    onClick: () => p.onActivateTab(tab.id),
    onKeyDown: (e: ReactKeyEvent<HTMLButtonElement>) => onTabKey(i, e),
    className: tabBtnCls,
  });

  const closeTxt = t("tabs.close");
  const newTxt = t("tabs.newTab");

  return (
    <div className="flex h-10 shrink-0 items-center gap-1 border-b border-[color:var(--border)] bg-[color:var(--bg-elevated)] px-2 print:hidden in-data-[density=compact]:h-9">
      <div className="flex shrink-0 items-center gap-0.5">
        {renderBtn(t("tabs.back"), p.onGoBack, "←", navCls, !p.canGoBack)}
        {renderBtn(t("tabs.forward"), p.onGoForward, "→", navCls, !p.canGoForward)}
      </div>
      <div
        role="tablist"
        aria-label={t("tabs.listLabel")}
        onWheel={(e) => {
          if (e.deltaY !== 0) e.currentTarget.scrollLeft += e.deltaY;
        }}
        className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {p.tabs.map((tab, i) => {
          const isActive = tab.id === p.activeTabId;
          const label = tab.object
            ? formatObjectTitle(tab.object, i18n.language, t("editor.untitled"))
            : newTxt;
          const isDrop = drag !== null && drag[1] === i && drag[0] !== i;
          const pinCls = `${iconCls} ${tab.pinned ? "font-bold text-[color:var(--fg)]" : "text-[color:var(--fg-muted)] hover:text-[color:var(--fg)]"}`;
          const pinTxt = t(tab.pinned ? "tabs.unpin" : "tabs.pin");
          return (
            <div key={tab.id} {...rowProps(tab, i, isDrop, isActive)}>
              <button {...itemProps(tab, i, label, isActive)}>
                {tab.pinned && badgeEl}
                <span className="truncate">{label}</span>
              </button>
              {renderBtn(pinTxt, () => p.onTogglePinTab(tab.id), "⌖", pinCls, false, tab.pinned)}
              {renderBtn(closeTxt, () => p.onCloseTab(tab.id), "×", closeCls, tab.pinned)}
            </div>
          );
        })}
      </div>
      {renderBtn(newTxt, p.onOpenNewTab, "+", newCls)}
      {renderBtn(t("tabs.split"), p.onSplit, "◫", newCls)}
    </div>
  );
}
