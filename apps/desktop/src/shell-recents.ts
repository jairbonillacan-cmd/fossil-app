/** Recent actions and pages (#86), persisted in localStorage with guarded access like `shell-prefs.ts`. */
export type RecentKind = "actions" | "pages";

const KEYS: Record<RecentKind, string> = {
  actions: "fossil.recent.actions",
  pages: "fossil.recent.pages",
};
export const RECENT_LIMITS: Record<RecentKind, number> = { actions: 5, pages: 8 };

// Storage can be unavailable (private mode, quota, policies): recents then
// simply stay empty instead of crashing the shell.
function read(kind: RecentKind): string[] {
  try {
    const raw = localStorage.getItem(KEYS[kind]);
    const parsed: unknown = raw === null ? [] : JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === "string" && v !== "");
  } catch {
    return [];
  }
}

function write(kind: RecentKind, ids: string[]): void {
  try {
    localStorage.setItem(KEYS[kind], JSON.stringify(ids));
  } catch {
    // Not persisted; the list still works for this session.
  }
}

const session: Record<RecentKind, string[] | null> = { actions: null, pages: null };

/** Most recent first, at most `RECENT_LIMITS[kind]` ids. */
export function listRecents(kind: RecentKind): string[] {
  return (session[kind] ?? read(kind)).slice(0, RECENT_LIMITS[kind]);
}

/** Moves `id` to the front, deduplicated and capped. Returns the new list. */
export function pushRecent(kind: RecentKind, id: string): string[] {
  const next = [id, ...listRecents(kind).filter((v) => v !== id)].slice(0, RECENT_LIMITS[kind]);
  session[kind] = next;
  write(kind, next);
  return next;
}

export function clearRecents(kind: RecentKind): void {
  session[kind] = [];
  write(kind, []);
}

/** Test helper: forgets the in-memory copy so the next read hits storage again. */
export function resetRecentsCache(): void {
  session.actions = null;
  session.pages = null;
}
