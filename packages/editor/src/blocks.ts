import { InputRule, mergeAttributes, Node, wrappingInputRule } from "@tiptap/core";
import type { Node as ProseMirrorNode, Schema } from "@tiptap/pm/model";
import { type EditorState, TextSelection, type Transaction } from "@tiptap/pm/state";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    callout: { setCallout: () => ReturnType; toggleCallout: () => ReturnType };
    table: { insertTable: (options?: { rows?: number; cols?: number }) => ReturnType };
  }
}

/** Monochrome callout container block (`aside[data-type="callout"]`, #105). */
export const Callout = Node.create({
  name: "callout",
  group: "block",
  content: "block+",
  defining: true,
  parseHTML: () => [{ tag: 'aside[data-type="callout"]' }, { tag: "aside.fossil-callout" }],
  renderHTML: ({ HTMLAttributes }) => [
    "aside",
    mergeAttributes(HTMLAttributes, { "data-type": "callout", class: "fossil-callout" }),
    0,
  ],
  addCommands() {
    return {
      setCallout:
        () =>
        ({ commands }) =>
          commands.wrapIn(this.name),
      toggleCallout:
        () =>
        ({ commands }) =>
          commands.toggleWrap(this.name),
    };
  },
  addInputRules() {
    return [
      wrappingInputRule({ find: /^(?:>!\s|:::callout\s)$/, type: this.type }),
      // Typing `> ! ` first triggers Blockquote on `> `; convert that blockquote into a callout on `! `.
      new InputRule({
        find: /^!\s$/,
        handler: ({ state, range }) => {
          const { $from } = state.selection;
          if ($from.depth < 2 || $from.node(-1).type.name !== "blockquote") return null;
          const pos = $from.before(-1);
          const quote = state.doc.nodeAt(pos);
          if (!quote) return null;
          state.tr.setNodeMarkup(pos, this.type, quote.attrs).delete(range.from, range.to);
        },
      }),
    ];
  },
});

export const TableRow = Node.create({
  name: "tableRow",
  content: "(tableHeader | tableCell)+",
  parseHTML: () => [{ tag: "tr" }],
  renderHTML: ({ HTMLAttributes }) => ["tr", HTMLAttributes, 0],
});

export const TableHeader = Node.create({
  name: "tableHeader",
  content: "paragraph+",
  isolating: true,
  parseHTML: () => [{ tag: "th" }],
  renderHTML: ({ HTMLAttributes }) => ["th", HTMLAttributes, 0],
});

export const TableCell = Node.create({
  name: "tableCell",
  content: "paragraph+",
  isolating: true,
  parseHTML: () => [{ tag: "td" }],
  renderHTML: ({ HTMLAttributes }) => ["td", HTMLAttributes, 0],
});

/** Builds a `table` node matching the Yjs/ProseMirror content model (`table > tableRow > cell > paragraph`). */
export function createTableNode(
  schema: Schema,
  headers: readonly string[],
  bodyRows = 1,
): ProseMirrorNode {
  const cell = (tag: "tableHeader" | "tableCell", text = "") =>
    schema.node(tag, null, [schema.node("paragraph", null, text ? [schema.text(text)] : [])]);
  const head = schema.node(
    "tableRow",
    null,
    headers.map((h) => cell("tableHeader", h)),
  );
  const body = Array.from({ length: bodyRows }, () =>
    schema.node(
      "tableRow",
      null,
      headers.map(() => cell("tableCell")),
    ),
  );
  return schema.node("table", null, [head, ...body]);
}

/** Moves selection between table cells (`+1` next, `-1` previous), appending a row at the end on `+1`. */
export function moveTableCell(
  state: EditorState,
  dispatch: ((tr: Transaction) => void) | undefined,
  dir: 1 | -1,
): boolean {
  const { $from } = state.selection;
  let tableDepth = -1;
  for (let d = $from.depth; d >= 1; d--) {
    if ($from.node(d).type.name === "table") {
      tableDepth = d;
      break;
    }
  }
  if (tableDepth === -1 || $from.depth < tableDepth + 2) return false;
  const tablePos = $from.before(tableDepth);
  const tableNode = $from.node(tableDepth);
  const cells: number[] = [];
  tableNode.descendants((node, pos) => {
    if (node.type.name === "tableHeader" || node.type.name === "tableCell") {
      cells.push(tablePos + 1 + pos + 2);
      return false;
    }
    return true;
  });
  const idx = cells.indexOf($from.before(tableDepth + 2) + 2);
  if (idx === -1) return false;
  const next = cells[idx + dir];
  if (next !== undefined) {
    dispatch?.(state.tr.setSelection(TextSelection.create(state.doc, next)));
    return true;
  }
  if (dir === 1) {
    const cols = tableNode.firstChild?.childCount ?? 2;
    const rowCells = Array.from({ length: cols }, () =>
      state.schema.node("tableCell", null, [state.schema.node("paragraph")]),
    );
    const insertPos = tablePos + tableNode.nodeSize - 1;
    const tr = state.tr.insert(insertPos, state.schema.node("tableRow", null, rowCells));
    dispatch?.(tr.setSelection(TextSelection.create(tr.doc, insertPos + 3)));
  }
  return true;
}

/** Simple table block (`table > tableRow > tableHeader|tableCell > paragraph`, #105). */
export const Table = Node.create({
  name: "table",
  priority: 200,
  group: "block",
  content: "tableRow+",
  isolating: true,
  parseHTML: () => [{ tag: "table" }],
  renderHTML: ({ HTMLAttributes }) => [
    "table",
    mergeAttributes(HTMLAttributes, { class: "fossil-table" }),
    ["tbody", 0],
  ],
  addCommands() {
    return {
      insertTable:
        (options) =>
        ({ state, dispatch }) => {
          const cols = Math.max(1, options?.cols ?? 2);
          const bodyRows = Math.max(1, (options?.rows ?? 2) - 1);
          const node = createTableNode(
            state.schema,
            Array.from({ length: cols }, () => ""),
            bodyRows,
          );
          const { $from } = state.selection;
          const empty =
            $from.depth === 1 &&
            $from.parent.type.name === "paragraph" &&
            $from.parent.content.size === 0;
          const from = empty ? $from.before(1) : $from.after(1);
          const tr = state.tr.replaceWith(from, empty ? $from.after(1) : from, node);
          dispatch?.(tr.setSelection(TextSelection.create(tr.doc, from + 4)));
          return true;
        },
    };
  },
  addKeyboardShortcuts() {
    return {
      Tab: () => moveTableCell(this.editor.state, this.editor.view.dispatch, 1),
      "Shift-Tab": () => moveTableCell(this.editor.state, this.editor.view.dispatch, -1),
    };
  },
  addInputRules() {
    return [
      new InputRule({
        find: /^\|([^|\n]+(?:\|[^|\n]+)*)\|\s$/,
        handler: ({ state, range, match }) => {
          const raw = (match[1] ?? "").split("|").map((s) => s.trim());
          const headers = raw.length === 1 ? [raw[0] ?? "", ""] : raw;
          const { $from } = state.selection;
          const blockStart = $from.before($from.depth);
          const tr = state.tr.replaceWith(
            blockStart,
            range.to,
            createTableNode(state.schema, headers),
          );
          tr.setSelection(TextSelection.create(tr.doc, blockStart + 4 + (headers[0] ?? "").length));
        },
      }),
    ];
  },
});

export const TABLE_EXTENSIONS = [Table, TableRow, TableHeader, TableCell] as const;
