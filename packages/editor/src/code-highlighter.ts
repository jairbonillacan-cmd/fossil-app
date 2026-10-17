/**
 * Shiki engine for code blocks. Loaded only through `import("./code-highlighter")` the first time
 * a page contains a code block (#144); nothing else may import this module statically.
 * Uses the JavaScript regex engine (no WASM) and a CSS-variables theme so colors follow the
 * `@fossil/ui` tokens in light and dark.
 */
import { createCssVariablesTheme, createHighlighterCore, type HighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";

type Grammar = Exclude<
  Parameters<HighlighterCore["loadLanguage"]>[0],
  "ansi" | "text" | "plaintext" | "txt" | "plain"
>;
type GrammarLoader = () => Promise<{ default: unknown }>;

// Static literals so the bundler emits one lazy chunk per grammar.
const LOADERS: Readonly<Record<string, GrammarLoader>> = {
  javascript: () => import("shiki/dist/langs/javascript.mjs"),
  typescript: () => import("shiki/dist/langs/typescript.mjs"),
  jsx: () => import("shiki/dist/langs/jsx.mjs"),
  tsx: () => import("shiki/dist/langs/tsx.mjs"),
  json: () => import("shiki/dist/langs/json.mjs"),
  html: () => import("shiki/dist/langs/html.mjs"),
  css: () => import("shiki/dist/langs/css.mjs"),
  sql: () => import("shiki/dist/langs/sql.mjs"),
  python: () => import("shiki/dist/langs/python.mjs"),
  bash: () => import("shiki/dist/langs/bash.mjs"),
  powershell: () => import("shiki/dist/langs/powershell.mjs"),
  yaml: () => import("shiki/dist/langs/yaml.mjs"),
  markdown: () => import("shiki/dist/langs/markdown.mjs"),
  rust: () => import("shiki/dist/langs/rust.mjs"),
  go: () => import("shiki/dist/langs/go.mjs"),
  java: () => import("shiki/dist/langs/java.mjs"),
  csharp: () => import("shiki/dist/langs/csharp.mjs"),
  php: () => import("shiki/dist/langs/php.mjs"),
};

/** A highlighted run, relative to the start of the code text. `kind` is the token class suffix. */
export interface CodeSpan {
  from: number;
  to: number;
  kind: string;
}

export interface CodeEngine {
  has(lang: string): boolean;
  load(lang: string): Promise<void>;
  tokenize(code: string, lang: string): CodeSpan[];
}

const THEME_NAME = "fossil";

export async function createCodeEngine(): Promise<CodeEngine> {
  const theme = createCssVariablesTheme({ name: THEME_NAME, variablePrefix: "--shiki-" });
  const highlighter = await createHighlighterCore({
    themes: [theme],
    langs: [],
    engine: createJavaScriptRegexEngine({ forgiving: true }),
  });
  const loaded = new Set<string>();
  return {
    has: (lang) => loaded.has(lang),
    async load(lang) {
      const loader = LOADERS[lang];
      if (loader === undefined || loaded.has(lang)) return;
      await highlighter.loadLanguage((await loader()).default as Grammar);
      loaded.add(lang);
    },
    tokenize(code, lang) {
      const spans: CodeSpan[] = [];
      const lines = highlighter.codeToTokensBase(code, { lang, theme: THEME_NAME });
      for (const line of lines) {
        for (const token of line) {
          const match = /--shiki-token-([a-z-]+)/.exec(token.color ?? "");
          if (match?.[1] === undefined || token.content.trim().length === 0) continue;
          spans.push({
            from: token.offset,
            to: token.offset + token.content.length,
            kind: match[1],
          });
        }
      }
      return spans;
    },
  };
}
