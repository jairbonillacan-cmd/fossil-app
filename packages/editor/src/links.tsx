import { type Editor, Extension } from "@tiptap/core";
import type { Node as PmNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { type RefObject, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { EditorTranslator } from "./i18n";

export type WikilinkItem = { id: string; title: string };
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
}

const WIKILINK_RE = /\[\[([^[\]\n]+?)\]\]/g;
const TAG_RE = /(^|[\s([{"'])#([\p{L}\p{N}_-]+(?:\/[\p{L}\p{N}_-]+)*)/gu;

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

function buildLinkDecorations(doc: PmNode): DecorationSet {
  const decos: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    for (const s of parseInlineLinks(node.text)) {
      decos.push(
        Decoration.inline(pos + s.start, pos + s.end, {
          class: `fossil-${s.kind}`,
          [`data-${s.kind}`]: s.value,
        }),
      );
    }
  });
  return DecorationSet.create(doc, decos);
}

/** Renders inline `.fossil-wikilink` and `.fossil-tag` chips and handles Ctrl/Cmd+click (#24). */
export const LinksExtension = Extension.create<{
  onOpenRef?: RefObject<((target: string, options: OpenObjectOptions) => void) | undefined>;
}>({
  name: "fossilLinks",
  addOptions: () => ({}),
  addProseMirrorPlugins() {
    const { onOpenRef } = this.options;
    return [
      new Plugin<DecorationSet>({
        key: linksKey,
        state: {
          init: (_, s) => buildLinkDecorations(s.doc),
          apply: (tr, prev, _, next) => (tr.docChanged ? buildLinkDecorations(next.doc) : prev),
        },
        props: {
          decorations: (s) => linksKey.getState(s) ?? DecorationSet.empty,
          handleDOMEvents: {
            click(_view, event) {
              if (!(event.ctrlKey || event.metaKey)) return false;
              const el =
                event.target instanceof Element ? event.target.closest("[data-wikilink]") : null;
              const target = el?.getAttribute("data-wikilink");
              if (!target) return false;
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

/** Floating autocomplete menu for `[[` wikilinks (with "Crear «X»") and `#` tags (#24). */
export function LinkAutocompleteMenu(props: LinkAutocompleteProps) {
  const { editor, t, onSearchObjects, onCreateObject, onSearchTags } = props;
  const [match, setMatch] = useState<LinkTriggerMatch | null>(null);
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const [entries, setEntries] = useState<MenuEntry[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    if (!editor) return;
    const sync = () => {
      const m = matchLinkQuery(editor);
      setMatch(m);
      setActiveIndex(0);
      if (!m) setDismissedAt(null);
    };
    sync();
    editor.on("transaction", sync);
    return () => {
      editor.off("transaction", sync);
    };
  }, [editor]);

  const open = match !== null && dismissedAt !== match.range.from;

  useEffect(() => {
    if (!open || !match || !editor) return setEntries([]);
    let dead = false;
    const q = match.query.trim();
    const ql = q.toLowerCase();
    if (match.kind === "wikilink") {
      void Promise.resolve(onSearchObjects?.(q) ?? []).then((res) => {
        if (dead) return;
        const hits = res.filter((x) => !ql || x.title.toLowerCase().includes(ql));
        const next: MenuEntry[] = hits.map((x) => ({
          kind: "object",
          value: x.title,
          label: `[[${x.title}]]`,
        }));
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
  }, [open, match, editor, t, onSearchObjects, onSearchTags]);

  useEffect(() => {
    if (!open || !match || !editor) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setDismissedAt(match.range.from);
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
  }, [open, match, editor, entries, activeIndex, onCreateObject]);

  if (!open || !match || !editor) return null;
  let style = { top: "0px", left: "0px" };
  try {
    const box = editor.view.coordsAtPos(match.range.from);
    style = { top: `${box.bottom + 4}px`, left: `${box.left}px` };
  } catch {}
  return createPortal(
    <div
      role="listbox"
      aria-label={t(match.kind === "wikilink" ? "editor.wikilink.label" : "editor.tag.label")}
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
