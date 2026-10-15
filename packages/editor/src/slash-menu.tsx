import type { Editor, Range } from "@tiptap/core";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { EditorTranslationKey, EditorTranslator } from "./i18n";

export interface SlashCommandItem {
  id: string;
  labelKey: EditorTranslationKey;
  shortcut: string;
  keywords: readonly string[];
  icon: string;
  run: (editor: Editor, range: Range) => void;
}

const ICONS: Readonly<Record<string, string>> = {
  paragraph: "M4 7V4h16v3M9 20h6M12 4v16",
  heading1: "M4 12h8M4 18V6M12 18V6M17 12l3-2v8",
  heading2: "M4 12h8M4 18V6M12 18V6M21 18h-4c0-4 4-3 4-6 0-1.5-2-2.5-4-1",
  heading3:
    "M4 12h8M4 18V6M12 18V6M17.5 10.5c1.7-1 3.5 0 3.5 1.5a2 2 0 0 1-2 2c1.5 0 2 1 2 2s-1.8 2.5-3.5 1.5",
  bulletList: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01",
  orderedList: "M10 6h11M10 12h11M10 18h11M4 6h1v4M4 10h2M6 18H4c0-1 2-2 2-3s-1-1.5-2-1",
  taskList: "M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11",
  blockquote: "M3 21c3 0 7-1 7-8V5H4v6h3c0 4-4 5-4 5M15 21c3 0 7-1 7-8V5h-6v6h3c0 4-4 5-4 5",
  codeBlock: "m16 18 6-6-6-6M8 6l-6 6 6 6",
  callout: "M12 8v4M12 16h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z",
  horizontalRule: "M5 12h14",
  table: "M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5ZM3 10h18M10 3v18",
};

const runBlockCommand = (editor: Editor, range: Range, id: string): void => {
  const c = editor.chain().deleteRange(range);
  if (id === "paragraph") c.setParagraph().run();
  else if (id === "heading1") c.setHeading({ level: 1 }).run();
  else if (id === "heading2") c.setHeading({ level: 2 }).run();
  else if (id === "heading3") c.setHeading({ level: 3 }).run();
  else if (id === "bulletList") c.toggleBulletList().run();
  else if (id === "orderedList") c.toggleOrderedList().run();
  else if (id === "taskList") c.toggleTaskList().run();
  else if (id === "blockquote") c.toggleBlockquote().run();
  else if (id === "codeBlock") c.toggleCodeBlock().run();
  else if (id === "callout") c.toggleCallout().run();
  else if (id === "horizontalRule") c.setHorizontalRule().run();
  else if (id === "table") c.insertTable({ rows: 2, cols: 2 }).run();
};

const SPECS: ReadonlyArray<readonly [string, EditorTranslationKey, string, string]> = [
  ["paragraph", "editor.slash.paragraph", "p", "paragraph|text|texto|parrafo"],
  ["heading1", "editor.slash.heading1", "#", "h1|heading 1|encabezado 1|#"],
  ["heading2", "editor.slash.heading2", "##", "h2|heading 2|encabezado 2|##"],
  ["heading3", "editor.slash.heading3", "###", "h3|heading 3|encabezado 3|###"],
  ["bulletList", "editor.slash.bulletList", "-", "bullet|list|lista|viñetas|-"],
  ["orderedList", "editor.slash.orderedList", "1.", "ordered|number|numerada|1."],
  ["taskList", "editor.slash.taskList", "[]", "task|todo|tareas|check|[]"],
  ["blockquote", "editor.slash.blockquote", ">", "quote|blockquote|cita|>"],
  ["codeBlock", "editor.slash.codeBlock", "```", "code|codigo|código|pre|```"],
  ["callout", "editor.slash.callout", ">!", "callout|note|info|destacado|nota|aviso|>!"],
  [
    "horizontalRule",
    "editor.slash.horizontalRule",
    "---",
    "divider|horizontal|rule|hr|divisor|separador|---",
  ],
  ["table", "editor.slash.table", "| |", "table|grid|tabla|celdas|columnas"],
];

/** Alpha block commands exposed in the `/` slash menu. */
export const SLASH_COMMAND_ITEMS: readonly SlashCommandItem[] = SPECS.map(
  ([id, labelKey, shortcut, kw]) => ({
    id,
    labelKey,
    shortcut,
    keywords: kw.split("|"),
    icon: ICONS[id] ?? "",
    run: (editor, range) => runBlockCommand(editor, range, id),
  }),
);

interface SlashMatch {
  query: string;
  range: Range;
}

/** Detects a `/query` token right before the cursor inside the current textblock. */
export function matchSlashQuery(editor: Editor): SlashMatch | null {
  const { selection } = editor.state;
  if (!selection.empty) return null;
  const { $from } = selection;
  if (!$from.parent.isTextblock || $from.parent.type.name === "codeBlock") return null;
  const textBefore = $from.parent.textBetween(0, $from.parentOffset, undefined, "\ufffc");
  const match = /(?:^|\s)\/([^\s/]*)$/.exec(textBefore);
  if (match === null) return null;
  const query = match[1] ?? "";
  return { query, range: { from: $from.pos - (query.length + 1), to: $from.pos } };
}

export function filterSlashItems(query: string, t: EditorTranslator): readonly SlashCommandItem[] {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return SLASH_COMMAND_ITEMS;
  return SLASH_COMMAND_ITEMS.filter(
    (it) =>
      t(it.labelKey).toLowerCase().includes(q) ||
      it.id.toLowerCase().includes(q) ||
      it.keywords.some((kw) => kw.includes(q)),
  );
}

export interface SlashMenuProps {
  editor: Editor | null;
  t: EditorTranslator;
}

export interface CaretBox {
  top: number;
  bottom: number;
  left: number;
}

export interface SlashMenuPlacement {
  top: number;
  left: number;
  maxHeight: number;
}

const MENU_GAP = 8;
const VIEWPORT_MARGIN = 8;

/**
 * Where the menu goes (viewport coordinates, `position: fixed`): below the caret
 * when it fits, otherwise on the side with more room, never past the window
 * edges. The menu scrolls internally when even that side is too short.
 */
export function placeSlashMenu(
  caret: CaretBox,
  menu: { width: number; height: number },
  viewport: { width: number; height: number },
): SlashMenuPlacement {
  const below = viewport.height - caret.bottom - MENU_GAP - VIEWPORT_MARGIN;
  const above = caret.top - MENU_GAP - VIEWPORT_MARGIN;
  const maxLeft = viewport.width - menu.width - VIEWPORT_MARGIN;
  const left = Math.max(VIEWPORT_MARGIN, Math.min(caret.left, maxLeft));
  if (menu.height <= below || below >= above) {
    return { top: caret.bottom + MENU_GAP, left, maxHeight: Math.max(below, 0) };
  }
  const height = Math.min(menu.height, above);
  return { top: caret.top - MENU_GAP - height, left, maxHeight: above };
}

/** Popover menu triggered by typing `/` in a textblock; navigable by keyboard and mouse. */
export function SlashMenu({ editor, t }: SlashMenuProps) {
  const [match, setMatch] = useState<SlashMatch | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [dismissedFrom, setDismissedFrom] = useState<number | null>(null);

  useEffect(() => {
    if (editor === null) return;
    const sync = () => {
      const next = matchSlashQuery(editor);
      if (next === null) {
        setMatch(null);
        setDismissedFrom(null);
        return;
      }
      setMatch((prev) => {
        if (prev?.query !== next.query || prev.range.from !== next.range.from) setActiveIndex(0);
        return next;
      });
    };
    sync();
    editor.on("transaction", sync);
    return () => {
      editor.off("transaction", sync);
    };
  }, [editor]);

  const isOpen = editor !== null && match !== null && dismissedFrom !== match.range.from;
  const items = isOpen && match !== null ? filterSlashItems(match.query, t) : [];

  useEffect(() => {
    if (!isOpen || editor === null || match === null) return;
    const dom = editor.view.dom;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setDismissedFrom(match.range.from);
        return;
      }
      if (items.length === 0) return;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        if (event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return;
        event.preventDefault();
        event.stopPropagation();
        const delta = event.key === "ArrowDown" ? 1 : items.length - 1;
        setActiveIndex((prev) => (prev + delta) % items.length);
      } else if (event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        (items[activeIndex] ?? items[0])?.run(editor, match.range);
      }
    };
    dom.addEventListener("keydown", onKeyDown, true);
    return () => dom.removeEventListener("keydown", onKeyDown, true);
  }, [isOpen, editor, match, items, activeIndex]);

  // Float next to the caret instead of sitting in the document flow (#113: the
  // menu was clipped at the window bottom and pushed the page content).
  const menuRef = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<SlashMenuPlacement | null>(null);
  const from = match?.range.from ?? null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure when the item count changes the menu height.
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!isOpen || editor === null || from === null || el === null) {
      setPlacement(null);
      return;
    }
    let caret: CaretBox;
    try {
      caret = editor.view.coordsAtPos(from);
    } catch {
      // No layout (e.g. jsdom): anchor to the editor box instead of the caret.
      const box = editor.view.dom.getBoundingClientRect();
      caret = { top: box.top, bottom: box.top, left: box.left };
    }
    setPlacement(
      placeSlashMenu(
        caret,
        { width: el.offsetWidth, height: el.scrollHeight },
        { width: window.innerWidth, height: window.innerHeight },
      ),
    );
  }, [isOpen, editor, from, items.length]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll the newly active item into view.
  useEffect(() => {
    menuRef.current?.querySelector('[data-active="true"]')?.scrollIntoView?.({ block: "nearest" });
  }, [activeIndex]);

  if (!isOpen || editor === null || match === null) return null;

  return (
    <div
      ref={menuRef}
      className="fossil-slash-menu"
      role="listbox"
      aria-label={t("editor.slash.label")}
      style={
        placement === null
          ? { visibility: "hidden" }
          : { top: placement.top, left: placement.left, maxHeight: placement.maxHeight }
      }
    >
      {items.length === 0 ? (
        <div className="fossil-slash-empty">{t("editor.slash.empty")}</div>
      ) : (
        items.map((it, idx) => (
          <button
            key={it.id}
            type="button"
            role="option"
            aria-selected={idx === activeIndex}
            data-active={idx === activeIndex ? "true" : "false"}
            className="fossil-slash-item"
            onMouseEnter={() => setActiveIndex(idx)}
            onMouseDown={(event) => {
              event.preventDefault();
              it.run(editor, match.range);
            }}
          >
            <svg
              className="fossil-slash-icon"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d={it.icon} />
            </svg>
            <span className="fossil-slash-label">{t(it.labelKey)}</span>
            <kbd className="fossil-slash-shortcut">{it.shortcut}</kbd>
          </button>
        ))
      )}
    </div>
  );
}
