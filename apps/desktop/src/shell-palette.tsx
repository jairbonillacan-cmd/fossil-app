import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ObjectMeta, SearchHit } from "./bindings";
import { commands } from "./bindings";
import { type FuzzyMatch, fuzzyMatch, listCommands } from "./shell-commands";
import { formatObjectTitle, selectWorkspaceObject } from "./sidebar";

export type PaletteMode = "palette" | "switcher";

let paletteOpener: ((target: PaletteMode) => void) | null = null;
export const openPalette = (target: PaletteMode) => paletteOpener?.(target);

function renderHighlighted(text: string, indices: number[]) {
  if (indices.length === 0) return text;
  const hits = new Set(indices);
  return Array.from(text).map((ch, idx) =>
    hits.has(idx) ? (
      // biome-ignore lint/suspicious/noArrayIndexKey: static character index within label
      <mark key={idx} className="bg-transparent font-semibold text-[color:var(--fg)] underline">
        {ch}
      </mark>
    ) : (
      ch
    ),
  );
}

const EMPTY_SEARCH = { type_key: null, tag: null, updated_from: null, updated_to: null, limit: 20 };
const INPUT_CLS =
  "w-full rounded border border-[color:var(--border)] bg-[color:var(--bg)] px-3 py-2 text-sm text-[color:var(--fg)] placeholder:text-[color:var(--fg-muted)] focus-visible:outline-2 focus-visible:outline-[color:var(--accent)]";
const OPTION_CLS =
  "flex w-full cursor-pointer items-center justify-between gap-2 rounded px-2.5 py-1.5 text-left text-sm aria-selected:bg-[color-mix(in_srgb,var(--accent)_10%,var(--bg))] aria-selected:font-medium";

/** Command palette (`Ctrl+K`) and fuzzy quick switcher (`Ctrl+P`) (#27). */
export function ShellPalette(props: { onSelect?: ((object: ObjectMeta) => void) | undefined }) {
  const { t, i18n } = useTranslation();
  const [mode, setMode] = useState<PaletteMode | null>(null);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [objects, setObjects] = useState<ObjectMeta[]>([]);
  const [ftsHits, setFtsHits] = useState<SearchHit[] | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  const openMode = useCallback((target: PaletteMode, toggle = false) => {
    setMode((cur) => {
      if (cur === null && document.activeElement instanceof HTMLElement)
        openerRef.current = document.activeElement;
      return toggle && cur === target ? null : target;
    });
    setQuery("");
    setActiveIndex(0);
  }, []);
  paletteOpener = (target) => openMode(target, false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
      const k = e.key.toLowerCase();
      if (k !== "k" && k !== "p") return;
      e.preventDefault();
      openMode(k === "k" ? "palette" : "switcher", true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openMode]);

  useEffect(() => {
    if (mode === null) return void openerRef.current?.focus();
    inputRef.current?.focus();
    void commands
      .objectList?.({ include_archived: false, type_key: null, parent: null, query: null })
      ?.then((res) => setObjects(res.status === "ok" ? res.data : []));
  }, [mode]);

  useEffect(() => {
    if (mode !== "palette" || query.trim() === "" || !commands.searchQuery)
      return void setFtsHits(null);
    let alive = true;
    void commands.searchQuery({ ...EMPTY_SEARCH, text: query }).then((res) => {
      if (alive) setFtsHits(res.status === "ok" ? res.data : null);
    });
    return () => {
      alive = false;
    };
  }, [mode, query]);

  if (mode === null) return null;
  const close = () => setMode(null);
  const mkEntry = (k: string, l: string, b: string, m: FuzzyMatch | null, fn: () => void) => ({
    key: k,
    label: l,
    badge: b,
    indices: m?.indices ?? [],
    score: m?.score ?? 0,
    run: () => {
      fn();
      close();
    },
  });
  const openObj = (o: ObjectMeta) => {
    props.onSelect?.(o);
    selectWorkspaceObject(o);
  };
  const cmdBadge = t("palette.commandsHeading");
  const objBadge = t("palette.objectsHeading");

  const cmdEntries =
    mode !== "palette"
      ? []
      : listCommands()
          .flatMap((c) => {
            const m = fuzzyMatch(query, c.title);
            return m
              ? [mkEntry(`cmd:${c.id}`, c.title, c.shortcut ?? cmdBadge, m, () => void c.run())]
              : [];
          })
          .sort((a, b) => b.score - a.score);

  const objSource =
    mode === "palette" && ftsHits
      ? ftsHits.map(
          (h) =>
            objects.find((o) => o.id === h.object_id) ??
            ({ id: h.object_id, types: ["Page"], title: h.title, icon: null } as ObjectMeta),
        )
      : objects;
  const objEntries = objSource
    .flatMap((o) => {
      const lbl = formatObjectTitle(o, i18n.language, t("editor.untitled"));
      const m = fuzzyMatch(query, lbl);
      return ftsHits || m ? [mkEntry(`obj:${o.id}`, lbl, objBadge, m, () => openObj(o))] : [];
    })
    .sort((a, b) => (ftsHits ? 0 : b.score - a.score));

  const entries = [...cmdEntries, ...objEntries];
  const safeIdx = entries.length === 0 ? 0 : Math.min(activeIndex, entries.length - 1);
  const label = t(mode === "palette" ? "palette.commandLabel" : "palette.switcherLabel");
  const ph = t(mode === "palette" ? "palette.commandPlaceholder" : "palette.switcherPlaceholder");

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: backdrop click closes modal; keyboard uses Escape.
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-[color:var(--bg)]/75 p-4 pt-20"
      onMouseDown={(e) => e.target === e.currentTarget && close()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className="flex w-full max-w-lg flex-col rounded-lg border border-[color:var(--border)] bg-[color:var(--bg-elevated)] p-3 text-[color:var(--fg)]"
        onKeyDown={(e) => {
          if (e.key === "Escape") close();
          else if (e.key === "ArrowDown" && entries.length)
            setActiveIndex((safeIdx + 1) % entries.length);
          else if (e.key === "ArrowUp" && entries.length)
            setActiveIndex((safeIdx - 1 + entries.length) % entries.length);
          else if (e.key === "Enter" && entries[safeIdx]) entries[safeIdx].run();
          else if (e.key === "Tab") inputRef.current?.focus();
          else return;
          e.preventDefault();
        }}
      >
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded="true"
          aria-label={label}
          placeholder={ph}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActiveIndex(0);
          }}
          className={INPUT_CLS}
        />
        {entries.length === 0 ? (
          <p className="px-2 py-4 text-center text-xs text-[color:var(--fg-muted)]">
            {t("palette.empty")}
          </p>
        ) : (
          <div role="listbox" className="mt-2 flex max-h-72 flex-col gap-0.5 overflow-y-auto">
            {entries.map((item, idx) => (
              <button
                key={item.key}
                type="button"
                role="option"
                aria-selected={idx === safeIdx}
                onMouseEnter={() => setActiveIndex(idx)}
                onClick={item.run}
                className={OPTION_CLS}
              >
                <span className="truncate">{renderHighlighted(item.label, item.indices)}</span>
                <span className="shrink-0 font-mono text-xs text-[color:var(--fg-muted)]">
                  {item.badge}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
