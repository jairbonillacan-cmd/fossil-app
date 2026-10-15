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
export function fuzzyMatch(query: string, target: string): FuzzyMatch | null {
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
  return qi === qChars.length ? { score, indices } : null;
}
