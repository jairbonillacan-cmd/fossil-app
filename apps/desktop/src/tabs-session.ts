import { useCallback, useEffect, useRef } from "react";
import type { ObjectMeta } from "./bindings";

/** Recoverable tabs session per Espacio, stored in the frontend's localStorage (#29). */
export const SESSION_VERSION = 1;
const MAX_TABS = 200;
const MAX_HISTORY = 500;

export interface SessionTab {
  objectId: string | null;
  pinned: boolean;
}

export interface TabsSession {
  v: typeof SESSION_VERSION;
  tabs: SessionTab[];
  active: number | null;
  history: string[];
  historyIndex: number;
  scroll: Record<string, number>;
}

export interface RestoredTabs {
  tabs: Array<{ object: ObjectMeta | null; pinned: boolean }>;
  active: number | null;
  history: ObjectMeta[];
  historyIndex: number;
}

const storageKey = (vault: string) => `fossil.tabs.session:${vault}`;

const isObj = (x: unknown): x is Record<string, unknown> =>
  typeof x === "object" && x !== null && !Array.isArray(x);
const isId = (x: unknown): x is string => typeof x === "string" && x.length > 0 && x.length < 200;

/** Validates untrusted JSON; returns null for corrupt or other-version data. */
export function parseSession(raw: string | null): TabsSession | null {
  if (!raw) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObj(data) || data.v !== SESSION_VERSION) return null;
  if (!Array.isArray(data.tabs) || !Array.isArray(data.history)) return null;
  const tabs: SessionTab[] = [];
  for (const t of data.tabs.slice(0, MAX_TABS)) {
    if (!isObj(t) || !(t.objectId === null || isId(t.objectId))) return null;
    tabs.push({ objectId: t.objectId, pinned: t.pinned === true });
  }
  const history = data.history.slice(0, MAX_HISTORY);
  if (!history.every(isId)) return null;
  const active =
    typeof data.active === "number" && Number.isInteger(data.active) && data.active < tabs.length
      ? Math.max(data.active, 0)
      : null;
  const hi = typeof data.historyIndex === "number" ? Math.trunc(data.historyIndex) : -1;
  const scroll: Record<string, number> = {};
  if (isObj(data.scroll)) {
    for (const [k, y] of Object.entries(data.scroll)) {
      if (typeof y === "number" && Number.isFinite(y) && y > 0) scroll[k] = Math.round(y);
    }
  }
  return {
    v: SESSION_VERSION,
    tabs,
    active,
    history: history as string[],
    historyIndex: Math.min(Math.max(hi, -1), history.length - 1),
    scroll,
  };
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

/** Rebuilds tabs from a saved session, dropping pages deleted or archived since. */
export function restoreSession(session: TabsSession, objects: ObjectMeta[]): RestoredTabs {
  const byId = new Map(objects.filter((o) => !o.archived).map((o) => [o.id, o]));
  const tabs: RestoredTabs["tabs"] = [];
  let active: number | null = null;
  session.tabs.forEach((t, i) => {
    const object = t.objectId === null ? null : (byId.get(t.objectId) ?? undefined);
    if (object === undefined) return;
    if (i === session.active) active = tabs.length;
    tabs.push({ object, pinned: t.pinned });
  });
  if (active === null && tabs.length > 0) active = tabs.length - 1;
  const history: ObjectMeta[] = [];
  let historyIndex = -1;
  session.history.forEach((id, i) => {
    const o = byId.get(id);
    if (!o) return;
    history.push(o);
    if (i <= session.historyIndex) historyIndex = history.length - 1;
  });
  if (historyIndex === -1 && history.length > 0) historyIndex = 0;
  return { tabs, active, history, historyIndex };
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

  useEffect(() => {
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
