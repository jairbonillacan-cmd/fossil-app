export interface ShellCommand {
  id: string;
  title: string;
  shortcut?: string | undefined;
  run: () => void | Promise<void>;
}

export interface FuzzyMatch {
  score: number;
  indices: number[];
}

const registry = new Map<string, ShellCommand>();

/** Typed command registry (#27): registers a shell action and returns its unregister callback. */
export function registerCommand(command: ShellCommand): () => void {
  registry.set(command.id, command);
  return () => {
    if (registry.get(command.id) === command) registry.delete(command.id);
  };
}

export const listCommands = (): ShellCommand[] => Array.from(registry.values());
export const clearCommands = (): void => registry.clear();

const foldChar = (ch: string) =>
  ch
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

/** Diacritic-insensitive subsequence matcher (#27) returning score and matched indices. */
export function fuzzyMatch(
  query: string,
  target: string,
  opts: { typo?: boolean } = {},
): FuzzyMatch | null {
  const qChars = Array.from(query.trim(), foldChar).filter((c) => c !== "");
  if (qChars.length === 0) return { score: 0, indices: [] };
  const tChars = Array.from(target, foldChar);
  const indices: number[] = [];
  let qi = 0;
  let score = 0;
  let prev = -2;
  for (let ti = 0; ti < tChars.length && qi < qChars.length; ti++) {
    if (tChars[ti] === qChars[qi]) {
      indices.push(ti);
      const consecutive = ti === prev + 1 ? 8 : 0;
      const boundary = ti === 0 || /[\s\-_/]/.test(tChars[ti - 1] ?? "") ? 6 : 0;
      score += 4 + consecutive + boundary - (prev >= 0 ? ti - prev - 1 : ti);
      prev = ti;
      qi++;
    }
  }
  if (qi === qChars.length) return { score, indices };
  return opts.typo === false ? null : typoMatch(qChars.join(""), tChars);
}

const wordsOf = (folded: string) =>
  Array.from(folded.matchAll(/[^\s\-_/]+/g), (m) => ({ text: m[0], start: m.index ?? 0 }));

/** Optimal string alignment distance: insert, delete, replace and swap of neighbours cost 1. */
export function editDistance(a: string, b: string): number {
  const rows = Array.from({ length: a.length + 1 }, (_, i) => [
    i,
    ...new Array<number>(b.length).fill(0),
  ]);
  for (let j = 1; j <= b.length; j++) (rows[0] as number[])[j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let d = Math.min(
        ((rows[i - 1] as number[])[j] as number) + 1,
        ((rows[i] as number[])[j - 1] as number) + 1,
        ((rows[i - 1] as number[])[j - 1] as number) + cost,
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
        d = Math.min(d, ((rows[i - 2] as number[])[j - 2] as number) + 1);
      (rows[i] as number[])[j] = d;
    }
  }
  return (rows[a.length] as number[])[b.length] as number;
}

// Two errors only from 8 letters; the first letter must always match (avoids "exportar" ~ "importar").
const tolerance = (len: number) => (len <= 3 ? 0 : len < 8 ? 1 : 2);

/** Typo fallback (#86): every query word must be within edit distance of a target word or its prefix. */
function typoMatch(query: string, tChars: string[]): FuzzyMatch | null {
  const tokens = query.split(/[\s\-_/]+/).filter(Boolean);
  if (tokens.length === 0) return null;
  const words = wordsOf(tChars.join(""));
  const used = new Set<number>();
  const indices: number[] = [];
  let penalty = 0;
  for (const token of tokens) {
    const max = tolerance(token.length);
    let best: { at: number; dist: number; len: number } | null = null;
    words.forEach((w, at) => {
      // Cheap rejects before any edit distance: first letter and length gap.
      if (used.has(at) || w.text[0] !== token[0] || w.text.length < token.length - max) return;
      for (const len of [token.length, token.length - 1, token.length + 1]) {
        if (len < 1 || len > w.text.length) continue;
        const dist = editDistance(token, w.text.slice(0, len));
        if (dist <= max && (best === null || dist < best.dist)) best = { at, dist, len };
      }
    });
    if (best === null) return null;
    const hit = best as { at: number; dist: number; len: number };
    used.add(hit.at);
    penalty += hit.dist;
    const w = words[hit.at] as { text: string; start: number };
    for (let k = 0; k < hit.len; k++) indices.push(w.start + k);
  }
  return { score: -100 - penalty * 10, indices: indices.sort((x, y) => x - y) };
}
