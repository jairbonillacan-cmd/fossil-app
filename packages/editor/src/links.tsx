import { type Editor, Extension } from "@tiptap/core";
import type { Node as PmNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { type RefObject, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { EditorTranslator } from "./i18n";

/** `hint` tells pages with the same title apart in the menu (parent page or date, #137). */
export type WikilinkItem = { id: string; title: string; hint?: string };
/** A hand-typed `[[Título]]` shared by several pages, waiting for the person to pick one (#137). */
export type AmbiguousLinkPick = { title: string; range: { from: number; to: number } };
export type OpenObjectOptions = { newTab: boolean };
export type LinkTriggerMatch = {
  kind: "wikilink" | "tag";
  query: string;
  range: { from: number; to: number };
};
type Span = { kind: "wikilink" | "tag"; value: string; start: number; end: number };

export interface LinkAutocompleteProps {
  editor: Editor | null;
  t: EditorTranslator;
  onSearchObjects?: (q: string) => Promise<readonly WikilinkItem[]> | readonly WikilinkItem[];
  onCreateObject?: (title: string) => unknown;
  onSearchTags?: (q: string) => Promise<readonly string[]> | readonly string[];
  onOpenObject?: (target: string, options: OpenObjectOptions) => void;
  /** Lowercased titles shared by two or more pages: their `[[Título]]` is marked and asks (#137). */
  ambiguousTitles?: ReadonlySet<string>;
}

const WIKILINK_RE = /\[\[([^[\]\n]+?)\]\]/g;
const TAG_RE = /(^|[\s([{"'])#([\p{L}\p{N}_-]+(?:\/[\p{L}\p{N}_-]+)*)/gu;
const OBJECT_ID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

/**
 * Splits a wikilink body into its target id and visible title (#137). The id form
 * `[[<ObjectId>|Título]]` (or `<ObjectId>#<blockId>|Título`, contract #128) pins one page;
 * any other body is a title the core resolves by name, where `|` starts an alias.
 */
export function splitWikilink(value: string): { id: string | null; title: string } {
  const bar = value.indexOf("|");
  const head = bar === -1 ? value : value.slice(0, bar);
  const id = head.split("#")[0]?.trim() ?? "";
  if (bar !== -1 && OBJECT_ID_RE.test(id)) return { id, title: value.slice(bar + 1).trim() };
  return { id: null, title: head.trim() };
}

/** The id form of a wikilink, so a repeated title still points at the chosen page (#137). */
export const wikilinkToObject = (item: WikilinkItem) => `[[${item.id}|${item.title}]]`;

/** Parses completed `[[wikilink]]` and `#tag` (including `#marca/acme`) spans inside text (#24). */
export function parseInlineLinks(text: string): Span[] {
  const spans: Span[] = [];
  for (const m of text.matchAll(WIKILINK_RE)) {
    const value = (m[1] ?? "").trim();
    if (value && m.index !== undefined) {
      spans.push({ kind: "wikilink", value, start: m.index, end: m.index + m[0].length });
    }
  }
  for (const m of text.matchAll(TAG_RE)) {
    const value = m[2] ?? "";
    const start = (m.index ?? 0) + (m[1] ?? "").length;
    const end = start + 1 + value.length;
    if (value && !spans.some((s) => start < s.end && end > s.start)) {
      spans.push({ kind: "tag", value, start, end });
    }
  }
  return spans;
}

/** Collects unique `#tag` names present in the current document (#24). */
export function extractDocumentTags(doc: PmNode): string[] {
  const seen = new Set<string>();
  doc.descendants((node) => {
    if (!node.isText || !node.text) return;
    for (const s of parseInlineLinks(node.text)) if (s.kind === "tag") seen.add(s.value);
  });
  return [...seen];
}

/** Detects an active `[[query` or `#tag` trigger before the cursor (#24). */
export function matchLinkQuery(editor: Editor): LinkTriggerMatch | null {
  const { selection } = editor.state;
  const { $from } = selection;
  if (!selection.empty || $from.parent.type.spec.code) return null;
  const before = $from.parent.textBetween(0, $from.parentOffset, "\0", "\ufffc");
  const w = /\[\[([^[\]\n\0]*)$/.exec(before);
  if (w) {
    return {
      kind: "wikilink",
      query: w[1] ?? "",
      range: { from: selection.from - w[0].length, to: selection.from },
    };
  }
  const g = /(?:^|[\s([{"'])#([\p{L}\p{N}_/-]*)$/u.exec(before);
  const q = g?.[1] ?? "";
  return g
    ? { kind: "tag", query: q, range: { from: selection.from - q.length - 1, to: selection.from } }
    : null;
}

const linksKey = new PluginKey<DecorationSet>("fossilLinks");

function buildLinkDecorations(
  doc: PmNode,
  ambiguous?: ReadonlySet<string>,
  hint?: string,
): DecorationSet {
  const decos: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    for (const s of parseInlineLinks(node.text)) {
      const link = s.kind === "wikilink" ? splitWikilink(s.value) : null;
      const isAmbiguous = !!link && !link.id && !!ambiguous?.has(link.title.toLowerCase());
      decos.push(
        Decoration.inline(pos + s.start, pos + s.end, {
          class: `fossil-${s.kind}${isAmbiguous ? " fossil-wikilink-ambiguous" : ""}`,
          [`data-${s.kind}`]: s.value,
          ...(isAmbiguous ? { "data-ambiguous": "true", title: hint ?? "" } : {}),
        }),
      );
      if (link?.id) {
        // Hides `<ObjectId>|` (and `#<blockId>`): the page shows only the title.
        const hidden = s.value.indexOf("|") + 1;
        decos.push(
          Decoration.inline(pos + s.start + 2, pos + s.start + 2 + hidden, {
            class: "fossil-wikilink-id",
          }),
        );
      }
    }
  });
  return DecorationSet.create(doc, decos);
}

/** Finds the wikilink span under a document position, if any (#137). */
function wikilinkAt(doc: PmNode, pos: number): { value: string; from: number; to: number } | null {
  const $pos = doc.resolve(pos);
  if (!$pos.parent.isTextblock) return null;
  const text = $pos.parent.textBetween(0, $pos.parent.content.size, "\0", "￼");
  const span = parseInlineLinks(text).find(
    (s) => s.kind === "wikilink" && s.start <= $pos.parentOffset && $pos.parentOffset <= s.end,
  );
  if (!span) return null;
  const base = $pos.start();
  return { value: span.value, from: base + span.start, to: base + span.end };
}

/** Rebuilds link chips after the set of ambiguous titles changes outside the doc (#137). */
export function refreshLinkDecorations(editor: Editor) {
  editor.view.dispatch(editor.state.tr.setMeta(linksKey, true));
}

/** Renders inline `.fossil-wikilink` and `.fossil-tag` chips and handles Ctrl/Cmd+click (#24). */
export const LinksExtension = Extension.create<{
  onOpenRef?: RefObject<((target: string, options: OpenObjectOptions) => void) | undefined>;
  /** Lowercased titles shared by two or more pages (#137). */
  ambiguousRef?: RefObject<ReadonlySet<string> | undefined>;
  onAmbiguousRef?: RefObject<((pick: AmbiguousLinkPick) => void) | undefined>;
  tRef?: RefObject<EditorTranslator | undefined>;
}>({
  name: "fossilLinks",
  addOptions: () => ({}),
  addProseMirrorPlugins() {
    const { onOpenRef, ambiguousRef, onAmbiguousRef, tRef } = this.options;
    const build = (doc: PmNode) =>
      buildLinkDecorations(
        doc,
        ambiguousRef?.current,
        tRef?.current?.("editor.wikilink.ambiguous"),
      );
    return [
      new Plugin<DecorationSet>({
        key: linksKey,
        state: {
          init: (_, s) => build(s.doc),
          apply: (tr, prev, _, next) =>
            tr.docChanged || tr.getMeta(linksKey) ? build(next.doc) : prev,
        },
        props: {
          decorations: (s) => linksKey.getState(s) ?? DecorationSet.empty,
          handleDOMEvents: {
            click(view, event) {
              const el =
                event.target instanceof Element ? event.target.closest("[data-wikilink]") : null;
              const target = el?.getAttribute("data-wikilink");
              if (!el || !target) return false;
              // A repeated title never opens the first page in silence: it asks which one (#137).
              if (el.getAttribute("data-ambiguous") === "true" && onAmbiguousRef?.current) {
                const at = wikilinkAt(view.state.doc, view.posAtDOM(el, 0));
                if (!at) return false;
                event.preventDefault();
                onAmbiguousRef.current({
                  title: splitWikilink(at.value).title,
                  range: { from: at.from, to: at.to },
                });
                return true;
              }
              if (!(event.ctrlKey || event.metaKey)) return false;
              event.preventDefault();
              onOpenRef?.current?.(target, { newTab: true });
              return true;
            },
          },
        },
      }),
    ];
  },
});

/** `value` is what lands between `[[ ]]`: the title, or `<ObjectId>|Título` for a repeated one. */
type MenuEntry = { kind: "object" | "create" | "tag"; value: string; label: string };

function applyEntry(
  ed: Editor,
  range: { from: number; to: number },
  entry: MenuEntry,
  onCreate?: (title: string) => unknown,
) {
  if (entry.kind === "create") void onCreate?.(entry.value);
  ed.commands.insertContentAt(
    range,
    entry.kind === "tag" ? `#${entry.value} ` : `[[${entry.value}]]`,
  );
}

/** Menu rows for pages; titles that repeat get the id form and a hint to tell them apart (#137). */
function objectEntries(hits: readonly WikilinkItem[]): MenuEntry[] {
  const count = new Map<string, number>();
  for (const x of hits)
    count.set(x.title.toLowerCase(), (count.get(x.title.toLowerCase()) ?? 0) + 1);
  return hits.map((x) =>
    (count.get(x.title.toLowerCase()) ?? 0) > 1
      ? {
          kind: "object",
          value: `${x.id}|${x.title}`,
          label: `[[${x.title}]] · ${x.hint ?? x.id.slice(-6)}`,
        }
      : { kind: "object", value: x.title, label: `[[${x.title}]]` },
  );
}

/** Floating autocomplete menu for `[[` wikilinks (with "Crear «X»") and `#` tags (#24). */
export function LinkAutocompleteMenu(
  props: LinkAutocompleteProps & {
    /** The links plugin calls this when a repeated `[[Título]]` is clicked (#137). */
    pickRef?: { current: ((pick: AmbiguousLinkPick) => void) | undefined };
  },
) {
  const { editor, t, onSearchObjects, onCreateObject, onSearchTags, pickRef } = props;
  const [typed, setMatch] = useState<LinkTriggerMatch | null>(null);
  const [pick, setPick] = useState<AmbiguousLinkPick | null>(null);
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const [entries, setEntries] = useState<MenuEntry[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    if (!pickRef) return;
    pickRef.current = (next) => {
      setPick(next);
      setActiveIndex(0);
    };
    return () => {
      pickRef.current = undefined;
    };
  }, [pickRef]);

  // Picking among repeated titles replaces the typed `[[Título]]` in place.
  const match = useMemo<LinkTriggerMatch | null>(
    () => (pick ? { kind: "wikilink", query: pick.title, range: pick.range } : typed),
    [pick, typed],
  );

  useEffect(() => {
    if (!editor) return;
    const sync = () => {
      const m = matchLinkQuery(editor);
      setMatch(m);
      setActiveIndex(0);
      if (!m) setDismissedAt(null);
    };
    const closePick = ({ transaction }: { transaction: { docChanged: boolean } }) => {
      if (transaction.docChanged) setPick(null);
    };
    editor.on("transaction", closePick);
    sync();
    editor.on("transaction", sync);
    return () => {
      editor.off("transaction", sync);
      editor.off("transaction", closePick);
    };
  }, [editor]);

  const open = match !== null && (pick !== null || dismissedAt !== match.range.from);

  useEffect(() => {
    if (!open || !match || !editor) return setEntries([]);
    let dead = false;
    const q = match.query.trim();
    const ql = q.toLowerCase();
    if (match.kind === "wikilink") {
      void Promise.resolve(onSearchObjects?.(q) ?? []).then((res) => {
        if (dead) return;
        const hits = res.filter((x) =>
          pick ? x.title.toLowerCase() === ql : !ql || x.title.toLowerCase().includes(ql),
        );
        const next = objectEntries(hits);
        if (pick) {
          // The id form is the only way to keep the choice once two pages share a title.
          setEntries(
            hits.map((x) => ({
              kind: "object",
              value: `${x.id}|${x.title}`,
              label: `${x.title} · ${x.hint ?? x.id.slice(-6)}`,
            })),
          );
          return;
        }
        if (q && !hits.some((x) => x.title.toLowerCase() === ql)) {
          next.push({ kind: "create", value: q, label: `${t("editor.wikilink.create")} «${q}»` });
        }
        setEntries(next);
      });
    } else {
      void Promise.resolve(onSearchTags?.(q) ?? []).then((res) => {
        if (dead) return;
        const all = [...new Set([...extractDocumentTags(editor.state.doc), ...res])];
        const hits = all.filter((x) => !ql || x.toLowerCase().includes(ql));
        setEntries(hits.map((x) => ({ kind: "tag", value: x, label: `#${x}` })));
      });
    }
    return () => {
      dead = true;
    };
  }, [open, match, pick, editor, t, onSearchObjects, onSearchTags]);

  useEffect(() => {
    if (!open || !match || !editor) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        if (pick) setPick(null);
        else setDismissedAt(match.range.from);
      } else if ((e.key === "ArrowDown" || e.key === "ArrowUp") && entries.length > 0) {
        e.preventDefault();
        const step = e.key === "ArrowDown" ? 1 : entries.length - 1;
        setActiveIndex((i) => (i + step) % entries.length);
      } else if (e.key === "Enter" && entries.length > 0) {
        const picked = entries[activeIndex] ?? entries[0];
        if (picked) {
          e.preventDefault();
          applyEntry(editor, match.range, picked, onCreateObject);
        }
      }
    };
    const dom = editor.view.dom;
    dom.addEventListener("keydown", onKeyDown, true);
    return () => dom.removeEventListener("keydown", onKeyDown, true);
  }, [open, match, pick, editor, entries, activeIndex, onCreateObject]);

  if (!open || !match || !editor) return null;
  let style = { top: "0px", left: "0px" };
  try {
    const box = editor.view.coordsAtPos(match.range.from);
    style = { top: `${box.bottom + 4}px`, left: `${box.left}px` };
  } catch {}
  return createPortal(
    <div
      role="listbox"
      aria-label={t(
        pick
          ? "editor.wikilink.pick"
          : match.kind === "wikilink"
            ? "editor.wikilink.label"
            : "editor.tag.label",
      )}
      className="fossil-slash-menu fossil-link-menu"
      style={style}
    >
      {entries.length === 0 ? (
        <div className="fossil-slash-empty">{t("editor.slash.empty")}</div>
      ) : (
        entries.map((entry, idx) => (
          <button
            key={`${entry.kind}:${entry.value}`}
            type="button"
            role="option"
            aria-selected={idx === activeIndex}
            className="fossil-slash-item"
            data-active={idx === activeIndex ? "true" : "false"}
            onMouseEnter={() => setActiveIndex(idx)}
            onMouseDown={(e) => {
              e.preventDefault();
              applyEntry(editor, match.range, entry, onCreateObject);
            }}
          >
            {entry.label}
          </button>
        ))
      )}
    </div>,
    document.body,
  );
}
