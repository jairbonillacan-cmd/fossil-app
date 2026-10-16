import {
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import type { ObjectMeta } from "./bindings";
import { formatObjectTitle } from "./sidebar";

export interface WorkspaceTab {
  id: string;
  object: ObjectMeta | null;
  pinned: boolean;
}

interface TabsState {
  tabs: WorkspaceTab[];
  activeTabId: string | null;
  history: ObjectMeta[];
  historyIndex: number;
}

let nextTabSeq = 1;
const mkTab = (object: ObjectMeta | null): WorkspaceTab => ({
  id: `tab-${nextTabSeq++}`,
  object,
  pinned: false,
});

/** State hook for workspace tabs, pin/close/reorder and back/forward page history (#106). */
export function useWorkspaceTabs(initialTabs: WorkspaceTab[] = []) {
  const [s, setS] = useState<TabsState>(() => ({
    tabs: initialTabs,
    activeTabId: initialTabs[0]?.id ?? null,
    history: initialTabs[0]?.object ? [initialTabs[0].object] : [],
    historyIndex: initialTabs[0]?.object ? 0 : -1,
  }));
  const activeTab = s.tabs.find((t) => t.id === s.activeTabId) ?? null;
  const pushHist = (prev: TabsState, obj: ObjectMeta) => {
    const history = [...prev.history.slice(0, prev.historyIndex + 1), obj];
    return { history, historyIndex: history.length - 1 };
  };
  const stepHistory = (delta: -1 | 1) =>
    setS((prev) => {
      const historyIndex = prev.historyIndex + delta;
      const target = prev.history[historyIndex];
      if (historyIndex < 0 || historyIndex >= prev.history.length || !target) return prev;
      const existing = prev.tabs.find((t) => t.object?.id === target.id);
      if (existing) return { ...prev, activeTabId: existing.id, historyIndex };
      const nt = mkTab(target);
      return { ...prev, tabs: [...prev.tabs, nt], activeTabId: nt.id, historyIndex };
    });

  return {
    tabs: s.tabs,
    activeTabId: s.activeTabId,
    selectedObject: activeTab?.object ?? null,
    canGoBack: s.historyIndex > 0,
    canGoForward: s.historyIndex >= 0 && s.historyIndex < s.history.length - 1,
    selectObject: (target: ObjectMeta) =>
      setS((prev) => {
        const cur = prev.tabs.find((t) => t.id === prev.activeTabId) ?? null;
        const hit = cur?.object === null ? cur : prev.tabs.find((t) => t.object?.id === target.id);
        const h =
          cur?.object?.id === target.id
            ? { history: prev.history.map((x) => (x.id === target.id ? target : x)) }
            : pushHist(prev, target);
        if (hit) {
          const tabs = prev.tabs.map((t) => (t.id === hit.id ? { ...t, object: target } : t));
          return { ...prev, tabs, activeTabId: hit.id, ...h };
        }
        const nt = mkTab(target);
        return { ...prev, tabs: [...prev.tabs, nt], activeTabId: nt.id, ...h };
      }),
    updateObject: (u: ObjectMeta) =>
      setS((prev) => ({
        ...prev,
        tabs: prev.tabs.map((t) => (t.object?.id === u.id ? { ...t, object: u } : t)),
        history: prev.history.map((x) => (x.id === u.id ? u : x)),
      })),
    onActivateTab: (tabId: string) =>
      setS((prev) => {
        const t = prev.tabs.find((x) => x.id === tabId);
        if (!t || prev.activeTabId === tabId) return prev;
        const h =
          t.object && prev.history[prev.historyIndex]?.id !== t.object.id
            ? pushHist(prev, t.object)
            : {};
        return { ...prev, activeTabId: tabId, ...h };
      }),
    onOpenNewTab: () =>
      setS((prev) => {
        const nt = mkTab(null);
        return { ...prev, tabs: [...prev.tabs, nt], activeTabId: nt.id };
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
        return { ...prev, tabs, activeTabId };
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
  "selectedObject" | "selectObject" | "updateObject"
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
  "shrink-0 rounded px-1 py-0.5 text-[11px] leading-none focus-visible:outline-2 focus-visible:outline-[color:var(--accent)]";
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
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "w") {
        e.preventDefault();
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
          const pinCls = `${iconCls} ${tab.pinned ? "font-bold text-[color:var(--fg)]" : "text-[color:var(--fg-muted)] opacity-70 hover:opacity-100"}`;
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
    </div>
  );
}
