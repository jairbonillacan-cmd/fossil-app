import { splitWikilink, type WikilinkItem } from "@fossil/editor";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { commands, events, type ObjectId, type ObjectMeta } from "./bindings";

const MAX_SUGGESTIONS = 20;
const key = (title: string) => title.trim().toLowerCase();

/** Titles used by two or more live pages: their `[[Título]]` is marked and asks which page (#137). */
export function repeatedTitles(objects: readonly ObjectMeta[]): ReadonlySet<string> {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const o of objects) {
    const k = key(o.title);
    if (!k) continue;
    if (seen.has(k)) repeated.add(k);
    else seen.add(k);
  }
  return repeated;
}

/** The menu hint for a repeated title: its parent page, or else the day it was created. */
export function titleHint(
  object: ObjectMeta,
  byId: ReadonlyMap<ObjectId, ObjectMeta>,
  language: string,
): string {
  const parent = object.parent ? byId.get(object.parent) : undefined;
  if (parent?.title.trim()) return parent.title.trim();
  const created = new Date(object.created_at);
  return Number.isNaN(created.getTime())
    ? object.id.slice(-6)
    : new Intl.DateTimeFormat(language, { dateStyle: "medium", timeZone: "UTC" }).format(created);
}

/**
 * Feeds the editor's `[[ ]]` links from the Space (#137): suggestions with hints for repeated
 * titles, the set of repeated titles, opening a link by id or by a unique title, and
 * "Crear «X»". Without this the page body never resolved links at all.
 */
export function usePageLinks(language: string, onOpen?: (object: ObjectMeta) => void) {
  const [objects, setObjects] = useState<readonly ObjectMeta[]>([]);
  const refresh = useCallback(async () => {
    const res = await commands
      .objectList?.({ include_archived: false, type_key: null, parent: null, query: null })
      .catch(() => null);
    if (res?.status === "ok") setObjects(res.data);
  }, []);
  const objectsRef = useRef<readonly ObjectMeta[]>([]);
  // Body edits fire object:changed every batch while typing: re-read only that page, and the
  // whole list only when something links depend on (title, parent, archived) actually moved.
  const onObjectChanged = useCallback(
    async (id: ObjectId) => {
      const known = objectsRef.current.find((o) => o.id === id);
      const res = known ? await commands.objectGet?.(id).catch(() => null) : null;
      const now = res?.status === "ok" ? res.data : null;
      if (
        known &&
        now &&
        now.title === known.title &&
        now.parent === known.parent &&
        now.archived === known.archived
      ) {
        return;
      }
      await refresh();
    },
    [refresh],
  );

  useEffect(() => {
    void refresh();
    let alive = true;
    let off = Promise.resolve<(() => void) | null>(null);
    try {
      off = events.objectChanged.listen((e) => {
        if (alive) void onObjectChanged(e.payload.id);
      });
    } catch {
      // Partial ./bindings mock without `events`.
    }
    return () => {
      alive = false;
      void off.then((fn) => fn?.());
    };
  }, [refresh, onObjectChanged]);

  const byId = useMemo(() => new Map(objects.map((o) => [o.id, o])), [objects]);
  const ambiguousTitles = useMemo(() => repeatedTitles(objects), [objects]);
  objectsRef.current = objects;
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;

  const onSearchObjects = useCallback(
    (q: string): WikilinkItem[] => {
      const ql = key(q);
      return objectsRef.current
        .filter((o) => o.title.trim() && (!ql || key(o.title).includes(ql)))
        .slice(0, MAX_SUGGESTIONS)
        .map((o) =>
          ambiguousTitles.has(key(o.title))
            ? { id: o.id, title: o.title.trim(), hint: titleHint(o, byId, language) }
            : { id: o.id, title: o.title.trim() },
        );
    },
    [ambiguousTitles, byId, language],
  );

  const onOpenObject = useCallback((target: string) => {
    const { id, title } = splitWikilink(target);
    const hits = id
      ? objectsRef.current.filter((o) => o.id === id)
      : objectsRef.current.filter((o) => key(o.title) === key(title));
    // A repeated title is never opened at random: the editor asks first.
    if (hits.length === 1 && hits[0]) onOpenRef.current?.(hits[0]);
  }, []);

  const onCreateObject = useCallback(
    async (title: string) => {
      await commands
        .objectCreate?.({ types: ["Page"], title: title.trim(), icon: null, parent: null })
        .catch(() => null);
      await refresh();
    },
    [refresh],
  );

  return { ambiguousTitles, onSearchObjects, onOpenObject, onCreateObject };
}
