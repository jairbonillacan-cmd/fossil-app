import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

// Guards the i18n rule (AGENTS.md #6): no visible UI text in the code. Scans
// the `.tsx` files of apps/desktop/src (tests excluded) for literal strings in
// JSX text nodes or in the aria-label/title/placeholder attributes; anything
// user-visible must go through t(). Pragmatic regex scanner, no AST.

const SRC_ROOT = join(import.meta.dirname, "..");

/**
 * Known exceptions, one comment each. Keep this list short: a new hardcoded
 * string must be routed through i18n or justified here.
 */
const ALLOWED: readonly string[] = [];

// Characters that betray TypeScript between tags (arrows, generics, calls)
// rather than prose. Braces and angle brackets are already excluded by the
// capture classes; JSX text cannot contain them unescaped.
const CODE_HINT = /[=;()@`|~^[\]]/;

function isTranslatableText(value: string): boolean {
  const text = value.trim();
  if (text.length === 0) return false;
  // Pure punctuation, symbols or numbers are not translatable copy.
  if (!/\p{L}/u.test(text)) return false;
  return !CODE_HINT.test(text);
}

/** A text node sits right after a tag closes and right before a tag opens. */
const JSX_TEXT_NODE = /(<[a-zA-Z][^<>]*>|<\/[a-zA-Z][^<>]*>)([^<>{}]+?)(?=<\/?[a-zA-Z])/g;
/** Literal (non-expression) values of visible-text attributes. */
const VISIBLE_ATTR = /\b(aria-label|title|placeholder)\s*=\s*(["'])([^"']*)\2/g;

function findHardcodedStrings(source: string): string[] {
  const found = new Set<string>();
  for (const match of source.matchAll(JSX_TEXT_NODE)) {
    const text = (match[2] ?? "").trim();
    if (isTranslatableText(text)) found.add(text);
  }
  for (const match of source.matchAll(VISIBLE_ATTR)) {
    const text = (match[3] ?? "").trim();
    if (isTranslatableText(text)) found.add(text);
  }
  return [...found];
}

function listSourceFiles(): string[] {
  // With a string root, recursive entries are always paths, not Buffers.
  return readdirSync(SRC_ROOT, { recursive: true })
    .filter((entry): entry is string => typeof entry === "string")
    .filter((entry) => {
      const name = entry.split(sep).at(-1) ?? "";
      return name.endsWith(".tsx") && !name.endsWith(".test.tsx");
    })
    .map((entry) => join(SRC_ROOT, entry));
}

describe("hardcoded UI strings", () => {
  it("routes every visible literal in JSX through i18n", () => {
    const flagged = new Set<string>();
    for (const file of listSourceFiles()) {
      const relPath = relative(SRC_ROOT, file).split(sep).join("/");
      for (const text of findHardcodedStrings(readFileSync(file, "utf8"))) {
        flagged.add(`${relPath}: ${JSON.stringify(text)}`);
      }
    }

    const allowed = new Set(ALLOWED);
    const unexpected = [...flagged].filter((item) => !allowed.has(item)).sort();
    const stale = [...allowed].filter((item) => !flagged.has(item)).sort();
    expect(
      unexpected,
      "New visible strings must use t() (see i18n/es-MX.json) or be justified in ALLOWED",
    ).toEqual([]);
    expect(stale, "Entries in ALLOWED no longer match any literal; remove them").toEqual([]);
  });
});
