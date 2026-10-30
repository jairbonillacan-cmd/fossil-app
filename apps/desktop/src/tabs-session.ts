import { useCallback, useLayoutEffect, useRef } from "react";
import type { ObjectMeta } from "./bindings";

/** Recoverable tabs session per Espacio, stored in the frontend's localStorage (#29, #173, #166). */
export const SESSION_VERSION = 2;
const MAX_TABS = 200;
const MAX_HISTORY = 500;

export interface SessionTab {
  objectId: string | null;
  pinned: boolean;
  /** Back/forward history of this tab (page ids) and the index of the page it shows. */
  history: string[];
  historyIndex: number;
}

export interface TabsSession {
  v: typeof SESSION_VERSION;
  tabs: SessionTab[];
  active: number | null;
  /** Second pane of a split work area (#166); absent in sessions saved before it. */
  split?: SessionTab | null;
  scroll: Record<string, number>;
}

export interface RestoredTab {
  object: ObjectMeta | null;
  pinned: boolean;
  history: ObjectMeta[];
  historyIndex: number;
}

export interface RestoredTabs {
  tabs: RestoredTab[];
  active: number | null;
  split: RestoredTab | null;
}

const storageKey = (vault: string) => `fossil.tabs.session:${vault}`;

const isObj = (x: unknown): x is Record<string, unknown> =>
  typeof x === "object" && x !== null && !Array.isArray(x);
const isId = (x: unknown): x is string => typeof x === "string" && x.length > 0 && x.length < 200;

/** Keeps only scroll offsets of pages that still have a live tab or history entry. */
export function trimScroll(
  scroll: Record<string, number>,
  tabs: SessionTab[],
): Record<string, number> {
  const live = new Set<string>();
  for (const t of tabs) {
    if (t.objectId) live.add(t.objectId);
    for (const id of t.history) live.add(id);
  }
  const out: Record<string, number> = {};
  for (const [k, y] of Object.entries(scroll)) {
    if (live.has(k) && typeof y === "number" && Number.isFinite(y) && y > 0) out[k] = Math.round(y);
  }
  return out;
}

function parseTab(t: unknown, version: number): SessionTab | null {
  if (!isObj(t) || !(t.objectId === null || isId(t.objectId))) return null;
  const pinned = t.pinned === true;
  if (version === 1) {
    // v1 kept one history for the whole bar: discard it, seed each tab with its own page.
    return {
      objectId: t.objectId,
      pinned,
      history: t.objectId ? [t.objectId] : [],
      historyIndex: t.objectId ? 0 : -1,
    };
  }
  if (!Array.isArray(t.history)) return null;
  const history = t.history.slice(0, MAX_HISTORY);
  if (!history.every(isId)) return null;
  const hi = typeof t.historyIndex === "number" ? Math.trunc(t.historyIndex) : -1;
  return {
    objectId: t.objectId,
    pinned,
    history: history as string[],
    historyIndex: Math.min(Math.max(hi, -1), history.length - 1),
  };
}

/** Validates untrusted JSON; returns null for corrupt data. Migrates v1 (global history) to v2. */
export function parseSession(raw: string | null): TabsSession | null {
  if (!raw) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObj(data) || (data.v !== 1 && data.v !== SESSION_VERSION)) return null;
  if (!Array.isArray(data.tabs)) return null;
  const tabs: SessionTab[] = [];
  for (const raw of data.tabs.slice(0, MAX_TABS)) {
    const tab = parseTab(raw, data.v);
    if (!tab) return null;
    tabs.push(tab);
  }
  const active =
    typeof data.active === "number" && Number.isInteger(data.active) && data.active < tabs.length
      ? Math.max(data.active, 0)
      : null;
  // A corrupt split pane only drops the pane, never the tabs.
  const split = data.v === SESSION_VERSION && data.split ? parseTab(data.split, data.v) : null;
  const live = split ? [...tabs, split] : tabs;
  const scroll = isObj(data.scroll) ? trimScroll(data.scroll as Record<string, number>, live) : {};
  return { v: SESSION_VERSION, tabs, active, ...(split ? { split } : {}), scroll };
}

export function loadSession(vault: string): TabsSession | null {
  try {
    return parseSession(window.localStorage.getItem(storageKey(vault)));
  } catch {
    return null;
  }
}

export function saveSession(vault: string, session: TabsSession): void {
  try {
    window.localStorage.setItem(storageKey(vault), JSON.stringify(session));
  } catch {
    // localStorage unavailable or full: the session is a convenience.
  }
}

/** Rebuilds one tab or pane; null when its page was deleted or archived since. */
function restoreTab(t: SessionTab, byId: Map<string, ObjectMeta>): RestoredTab | null {
  const object = t.objectId === null ? null : (byId.get(t.objectId) ?? undefined);
  if (object === undefined) return null;
  let history: ObjectMeta[] = [];
  let historyIndex = -1;
  t.history.forEach((id, h) => {
    const o = byId.get(id);
    if (!o) return;
    history.push(o);
    if (h <= t.historyIndex) historyIndex = history.length - 1;
  });
  if (historyIndex === -1 && history.length > 0) historyIndex = 0;
  if (object && history[historyIndex]?.id !== object.id) {
    history = [object];
    historyIndex = 0;
  } else if (!object) {
    history = [];
    historyIndex = -1;
  }
  return { object, pinned: t.pinned, history, historyIndex };
}

/** Rebuilds tabs (and the split pane) from a saved session, dropping pages deleted or archived since. */
export function restoreSession(session: TabsSession, objects: ObjectMeta[]): RestoredTabs {
  const byId = new Map(objects.filter((o) => !o.archived).map((o) => [o.id, o]));
  const tabs: RestoredTab[] = [];
  let active: number | null = null;
  session.tabs.forEach((t, i) => {
    const tab = restoreTab(t, byId);
    if (!tab) return;
    if (i === session.active) active = tabs.length;
    tabs.push(tab);
  });
  if (active === null && tabs.length > 0) active = tabs.length - 1;
  const split = session.split ? restoreTab(session.split, byId) : null;
  // A split pane whose page is gone closes rather than showing an empty pane.
  return { tabs, active, split: split?.object ? split : null };
}

// Scroll offsets live outside React state: scroll events are too frequent to re-render.
let scrollOffsets: Record<string, number> = {};
let flushScroll: (() => void) | null = null;
let flushTimer: ReturnType<typeof setTimeout> | undefined;

export const getScrollOffsets = () => scrollOffsets;
export const setScrollOffsets = (next: Record<string, number>) => {
  scrollOffsets = { ...next };
};
export const registerScrollFlush = (fn: (() => void) | null) => {
  flushScroll = fn;
};
export function recordScroll(objectId: string, y: number): void {
  if (y > 0) scrollOffsets[objectId] = Math.round(y);
  else delete scrollOffsets[objectId];
  clearTimeout(flushTimer);
  flushTimer = setTimeout(() => flushScroll?.(), 400);
}

/** Restores and records the scroll offset of the page shown in the returned element. */
export function usePageScroll(objectId: string | null) {
  const elRef = useRef<HTMLDivElement | null>(null);
  const restoring = useRef(true);

  // Layout effect: mark restoring before paint so the height change when switching pages
  // cannot record a clipped scroll under the new id.
  useLayoutEffect(() => {
    restoring.current = true;
    const target = objectId ? (scrollOffsets[objectId] ?? 0) : 0;
    let frame = 0;
    let tries = 0;
    const step = () => {
      const el = elRef.current;
      if (!el) return;
      const reachable = el.scrollHeight - el.clientHeight >= target;
      if (target === 0 || reachable || tries++ > 60) {
        el.scrollTop = target;
        restoring.current = false;
      } else {
        frame = requestAnimationFrame(step);
      }
    };
    step();
    return () => cancelAnimationFrame(frame);
  }, [objectId]);

  const onScroll = useCallback(() => {
    const el = elRef.current;
    if (el && objectId && !restoring.current) recordScroll(objectId, el.scrollTop);
  }, [objectId]);
  return { ref: elRef, onScroll };
}
