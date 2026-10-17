import { Extension } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { type EditorState, Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { CodeEngine, CodeSpan } from "./code-highlighter";
import { normalizeLanguage } from "./code-languages";

/** Blocks longer than this stay plain: tokenizing is synchronous on the main thread. */
const MAX_HIGHLIGHT_CHARS = 20_000;
const REFRESH = "fossilCodeHighlightReady";

interface HighlightState {
  decorations: DecorationSet;
  /** Languages used by the page's code blocks that the engine has not loaded yet. */
  missing: ReadonlySet<string>;
  hasCode: boolean;
}

const EMPTY: HighlightState = {
  decorations: DecorationSet.empty,
  missing: new Set(),
  hasCode: false,
};
export const codeHighlightKey = new PluginKey<HighlightState>("fossilCodeHighlight");

let engine: CodeEngine | null = null;
let enginePromise: Promise<CodeEngine> | null = null;

/** Loads the highlighter on first use; the dynamic import keeps it out of the initial chunk. */
function loadEngine(): Promise<CodeEngine> {
  enginePromise ??= import("./code-highlighter").then(async (m) => {
    engine = await m.createCodeEngine();
    return engine;
  });
  return enginePromise;
}

const spanCache = new WeakMap<PMNode, { lang: string; spans: readonly CodeSpan[] }>();

function spansFor(node: PMNode, lang: string, eng: CodeEngine): readonly CodeSpan[] {
  const cached = spanCache.get(node);
  if (cached?.lang === lang) return cached.spans;
  const spans =
    node.textContent.length > MAX_HIGHLIGHT_CHARS ? [] : eng.tokenize(node.textContent, lang);
  spanCache.set(node, { lang, spans });
  return spans;
}

function compute(state: EditorState): HighlightState {
  const decorations: Decoration[] = [];
  const missing = new Set<string>();
  let hasCode = false;
  state.doc.descendants((node, pos) => {
    if (node.type.name !== "codeBlock") return node.isTextblock ? false : true;
    hasCode = true;
    const lang = normalizeLanguage(node.attrs.language);
    if (lang === null || node.content.size === 0) return false;
    if (engine === null || !engine.has(lang)) {
      missing.add(lang);
      return false;
    }
    for (const s of spansFor(node, lang, engine)) {
      decorations.push(
        Decoration.inline(pos + 1 + s.from, pos + 1 + s.to, {
          class: `fossil-tok fossil-tok-${s.kind}`,
        }),
      );
    }
    return false;
  });
  return { decorations: DecorationSet.create(state.doc, decorations), missing, hasCode };
}

/** Syntax highlighting for `codeBlock` nodes as inline decorations; never touches the document. */
export const CodeHighlight = Extension.create({
  name: "codeHighlight",
  addProseMirrorPlugins() {
    return [
      new Plugin<HighlightState>({
        key: codeHighlightKey,
        state: {
          init: (_, state) => compute(state),
          apply: (tr, value, _old, state) =>
            tr.docChanged || tr.getMeta(REFRESH) === true
              ? compute(state)
              : value.decorations === EMPTY.decorations
                ? value
                : { ...value, decorations: value.decorations.map(tr.mapping, tr.doc) },
        },
        props: {
          decorations: (state) => codeHighlightKey.getState(state)?.decorations ?? null,
        },
        view: (view) => {
          let pending = false;
          const ensure = () => {
            const s = codeHighlightKey.getState(view.state);
            if (s === undefined || !s.hasCode || pending) return;
            if (engine !== null && s.missing.size === 0) return;
            pending = true;
            void loadEngine()
              .then(async (eng) => {
                const wanted = codeHighlightKey.getState(view.state)?.missing ?? new Set<string>();
                await Promise.all([...wanted].map((l) => eng.load(l)));
              })
              .catch(() => {
                /* highlighting is cosmetic: stay plain if a grammar fails to load */
                pending = false;
                return "failed" as const;
              })
              .then((r) => {
                if (r === "failed") return;
                pending = false;
                if (!view.isDestroyed)
                  view.dispatch(
                    view.state.tr.setMeta(REFRESH, true).setMeta("addToHistory", false),
                  );
              });
          };
          ensure();
          return { update: ensure };
        },
      }),
    ];
  },
});
