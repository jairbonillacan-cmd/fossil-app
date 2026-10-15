import { Button } from "@fossil/ui";
import { type RefObject, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ObjectMeta, SearchHit, TypeKey } from "./bindings";
import { commands } from "./bindings";
import { formatObjectTitle, selectWorkspaceObject } from "./sidebar";

export const SEARCH_DEBOUNCE_MS = 80;

const INPUT_CLS =
  "rounded border border-[color:var(--border)] bg-[color:var(--bg)] px-2.5 py-1.5 text-sm text-[color:var(--fg)] placeholder:text-[color:var(--fg-muted)] focus-visible:outline-2 focus-visible:outline-[color:var(--accent)]";
const INIT_FILTERS = { q: "", type: null as "Page" | "Journal" | null, tag: "", from: "", to: "" };
const TYPES = [null, "Page", "Journal"] as const;
const foldStr = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

/** Collects DOM `Range`s for every diacritic-insensitive match of `query` inside `root` (#29). */
export function findTextRanges(root: Node | null, query: string): Range[] {
  const needle = foldStr(query.trim());
  if (!root || needle.length === 0) return [];
  const ranges: Range[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const raw = node.textContent ?? "";
    const folded = foldStr(raw);
    for (let i = folded.indexOf(needle); i !== -1; i = folded.indexOf(needle, i + needle.length)) {
      const r = document.createRange();
      r.setStart(node, i);
      r.setEnd(node, Math.min(raw.length, i + needle.length));
      ranges.push(r);
    }
  }
  return ranges;
}

/** Compact `Ctrl+F` in-page search bar (#29) using CSS Custom Highlight API without mutating Yjs. */
export function PageFindBar({ containerRef }: { containerRef: RefObject<HTMLElement | null> }) {
  const { t } = useTranslation();
  const [{ open, q, idx }, setFind] = useState({ open: false, q: "", idx: 0 });
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setFind((s) => ({ ...s, open: true }));
        window.queueMicrotask(() => inputRef.current?.focus());
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const count = open ? findTextRanges(containerRef.current, q).length : 0;
  const safeIdx = count === 0 ? 0 : ((idx % count) + count) % count;
  useEffect(() => {
    const hl = (globalThis.CSS as unknown as { highlights?: Map<string, unknown> })?.highlights;
    const H = (globalThis as unknown as { Highlight?: new (...r: Range[]) => unknown }).Highlight;
    if (!open) return void hl?.delete("fossil-find");
    const r = findTextRanges(containerRef.current, q);
    if (hl && H) hl.set("fossil-find", new H(...r));
    r[safeIdx]?.startContainer.parentElement?.scrollIntoView?.({ block: "nearest" });
  }, [open, q, safeIdx, containerRef]);

  if (!open) return null;
  const step = (d: number) =>
    count > 0 && setFind((s) => ({ ...s, idx: (s.idx + d + count) % count }));
  const act = (d: number) => (d ? step(d) : setFind((s) => ({ ...s, open: false })));
  return (
    // biome-ignore lint/a11y/useSemanticElements: jsdom does not recognize <search>
    <div
      role="search"
      aria-label={t("search.findLabel")}
      data-find-matches={count}
      className="flex items-center gap-2 rounded border border-[color:var(--border)] bg-[color:var(--bg-elevated)] px-2.5 py-1.5 text-xs"
      onKeyDown={(e) => {
        if (e.key === "Escape") setFind((s) => ({ ...s, open: false }));
        if (e.key === "Enter") step(e.shiftKey ? -1 : 1);
      }}
    >
      <input
        ref={inputRef}
        type="search"
        value={q}
        aria-label={t("search.findLabel")}
        onChange={(e) => setFind({ open: true, q: e.target.value, idx: 0 })}
        className={`${INPUT_CLS} min-w-0 flex-1 py-1 text-xs`}
      />
      <span className="shrink-0 font-mono text-[color:var(--fg-muted)]">
        {count === 0 ? "0 / 0" : `${safeIdx + 1} / ${count}`}
      </span>
      {([-1, 1, 0] as const).map((d) => (
        <Button key={d} variant="secondary" onClick={() => act(d)}>
          {d < 0 ? "↑" : d > 0 ? "↓" : t("settings.close")}
        </Button>
      ))}
    </div>
  );
}

/** Global search screen (#29) with 80 ms debounce, type/tag/date filters, grouped results and highlighted snippets. */
export function ShellSearch(props: {
  open: boolean;
  onClose: () => void;
  onSelect?: ((o: ObjectMeta) => void) | undefined;
}) {
  const { open, onClose, onSelect } = props;
  const { t, i18n } = useTranslation();
  const [f, setF] = useState(INIT_FILTERS);
  const [objects, setObjects] = useState<ObjectMeta[]>([]);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return void openerRef.current?.focus();
    if (document.activeElement instanceof HTMLElement) openerRef.current = document.activeElement;
    inputRef.current?.focus();
    void commands
      .objectList?.({ include_archived: false, type_key: null, parent: null, query: null })
      ?.then((res) => setObjects(res.status === "ok" ? res.data : []));
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    let alive = true;
    const timer = window.setTimeout(() => {
      const cleanTag = f.tag.trim().replace(/^#/, "");
      void commands
        .searchQuery?.({
          text: f.q,
          type_key: f.type as TypeKey | null,
          tag: cleanTag !== "" ? cleanTag : null,
          updated_from: f.from !== "" ? `${f.from}T00:00:00.000Z` : null,
          updated_to: f.to !== "" ? `${f.to}T23:59:59.999Z` : null,
          limit: 50,
        })
        ?.then((res) => {
          if (alive) setHits(res.status === "ok" ? res.data : []);
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [open, f]);

  if (!open) return null;
  const pick = (obj: ObjectMeta) => {
    onSelect?.(obj);
    selectWorkspaceObject(obj);
    onClose();
  };
  const fallbackMeta = (h: SearchHit) =>
    ({ id: h.object_id, types: [f.type ?? "Page"], title: h.title, icon: null }) as ObjectMeta;
  const mapped = hits.map((hit) => ({
    hit,
    obj: objects.find((o) => o.id === hit.object_id) ?? fallbackMeta(hit),
  }));
  const groups = (
    [
      ["Page", t("sidebar.label"), mapped.filter((x) => !x.obj.types.includes("Journal"))],
      ["Journal", t("search.Journal"), mapped.filter((x) => x.obj.types.includes("Journal"))],
    ] as const
  ).filter(([, , items]) => items.length > 0);

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: backdrop click closes modal; keyboard uses Escape.
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-[color:var(--bg)]/75 p-4 pt-14"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("search.title")}
        className="flex max-h-[82dvh] w-full max-w-2xl flex-col gap-3 rounded-lg border border-[color:var(--border)] bg-[color:var(--bg-elevated)] p-4 text-[color:var(--fg)]"
        onKeyDown={(e) => e.key === "Escape" && onClose()}
      >
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold">{t("search.title")}</h2>
          <Button variant="secondary" onClick={onClose}>
            {t("settings.close")}
          </Button>
        </div>
        <input
          ref={inputRef}
          type="search"
          value={f.q}
          aria-label={t("search.title")}
          placeholder={t("search.placeholder")}
          onChange={(e) => setF((s) => ({ ...s, q: e.target.value }))}
          className={`${INPUT_CLS} w-full`}
        />
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {TYPES.map((key) => (
            <button
              key={key ?? "all"}
              type="button"
              aria-pressed={f.type === key}
              onClick={() => setF((s) => ({ ...s, type: key }))}
              className="rounded border border-[color:var(--border)] px-2.5 py-1 aria-pressed:bg-[color:var(--accent)] aria-pressed:font-semibold aria-pressed:text-[color:var(--accent-fg)]"
            >
              {t(key === "Page" ? "sidebar.label" : `search.${key ?? "all"}`)}
            </button>
          ))}
          {(["tag", "from", "to"] as const).map((field) => (
            <input
              key={field}
              type={field === "tag" ? "text" : "date"}
              value={f[field]}
              aria-label={t(`search.${field}`)}
              placeholder={t(`search.${field}`)}
              onChange={(e) => setF((s) => ({ ...s, [field]: e.target.value }))}
              className={`${INPUT_CLS} ${field === "tag" ? "w-28" : ""} py-1 text-xs`}
            />
          ))}
        </div>
        {groups.length === 0 ? (
          <p className="py-6 text-center text-xs text-[color:var(--fg-muted)]">
            {t("palette.empty")}
          </p>
        ) : (
          <div className="flex flex-col gap-3 overflow-y-auto">
            {groups.map(([kind, label, items]) => (
              <section key={kind} aria-label={label} className="flex flex-col gap-1">
                <h3 className="px-1 text-xs font-semibold uppercase tracking-wide text-[color:var(--fg-muted)]">
                  {label}
                </h3>
                {items.map(({ hit, obj }) => (
                  <button
                    key={hit.object_id}
                    type="button"
                    onClick={() => pick(obj)}
                    className="flex flex-col gap-0.5 rounded border border-[color:var(--border)] bg-[color:var(--bg)] p-2.5 text-left text-sm hover:border-[color:var(--accent)]"
                  >
                    <span className="font-medium">
                      {formatObjectTitle(obj, i18n.language, t("editor.untitled"))}
                    </span>
                    {hit.snippet.length > 0 && (
                      <p className="line-clamp-2 text-xs text-[color:var(--fg-muted)] [&>mark]:bg-transparent [&>mark]:font-semibold [&>mark]:text-[color:var(--fg)] [&>mark]:underline">
                        {hit.snippet.map((p, i) =>
                          // biome-ignore lint/suspicious/noArrayIndexKey: static snippet segment order
                          p.matched ? <mark key={i}>{p.text}</mark> : p.text,
                        )}
                      </p>
                    )}
                  </button>
                ))}
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
