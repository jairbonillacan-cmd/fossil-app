/** Languages offered by the code block selector (ids are the highlighter grammar names). */
export interface CodeLanguage {
  id: string;
  label: string;
  aliases: readonly string[];
}

export const CODE_LANGUAGES: readonly CodeLanguage[] = [
  { id: "javascript", label: "JavaScript", aliases: ["js", "mjs", "cjs", "node"] },
  { id: "typescript", label: "TypeScript", aliases: ["ts"] },
  { id: "jsx", label: "JSX", aliases: ["javascriptreact"] },
  { id: "tsx", label: "TSX", aliases: ["typescriptreact"] },
  { id: "json", label: "JSON", aliases: ["jsonc", "json5"] },
  { id: "html", label: "HTML", aliases: ["htm", "xml", "svg"] },
  { id: "css", label: "CSS", aliases: ["scss", "less"] },
  { id: "sql", label: "SQL", aliases: ["mysql", "postgres", "postgresql", "sqlite"] },
  { id: "python", label: "Python", aliases: ["py"] },
  { id: "bash", label: "Bash", aliases: ["sh", "shell", "shellscript", "zsh"] },
  { id: "powershell", label: "PowerShell", aliases: ["ps1", "pwsh"] },
  { id: "yaml", label: "YAML", aliases: ["yml"] },
  { id: "markdown", label: "Markdown", aliases: ["md"] },
  { id: "rust", label: "Rust", aliases: ["rs"] },
  { id: "go", label: "Go", aliases: ["golang"] },
  { id: "java", label: "Java", aliases: [] },
  { id: "csharp", label: "C#", aliases: ["cs", "c#"] },
  { id: "php", label: "PHP", aliases: [] },
];

const BY_NAME: ReadonlyMap<string, string> = new Map(
  CODE_LANGUAGES.flatMap((l) => [
    [l.id, l.id] as const,
    ...l.aliases.map((a) => [a, l.id] as const),
  ]),
);

/** Maps a stored `language` attribute (id or alias, any case) to a supported id, or `null`. */
export function normalizeLanguage(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return BY_NAME.get(value.trim().toLowerCase()) ?? null;
}

const MAX_SAMPLE = 4000;

/**
 * Cheap heuristic language detection for pasted code. Returns a supported id or `null` when
 * nothing is clear (the block then stays plain text). Pure and synchronous: no highlighter needed.
 */
export function detectLanguage(text: string): string | null {
  const s = text.slice(0, MAX_SAMPLE).trim();
  if (s.length < 3) return null;
  if (/^[{[][\s\S]*[}\]]$/.test(s) && /^[{[]\s*(?:"|[{[\]]|\d|-?true|false|null)/.test(s)) {
    try {
      JSON.parse(text.trim());
      return "json";
    } catch {
      /* fall through: JSON-ish snippets are usually JS */
    }
  }
  if (/^<(?:!doctype html|html|head|body|div|span|p|a|ul|section|main|svg|\?xml)\b/i.test(s)) {
    return "html";
  }
  if (
    /^\s*(?:select|insert\s+into|update|delete\s+from|create\s+(?:table|view|index)|with)\b[\s\S]*\b(?:from|into|set|values|table|as)\b/i.test(
      s,
    )
  ) {
    return "sql";
  }
  if (
    /^#!.*\b(?:ba|z)?sh\b/.test(s) ||
    /^\s*(?:\$ |sudo |npm |pnpm |git |curl |cd |echo |export )/m.test(s)
  ) {
    return "bash";
  }
  if (/^\s*(?:\$\w+\s*=|Get-\w+|Set-\w+|Write-Host|New-Item)/m.test(s)) return "powershell";
  if (/^\s*(?:fn\s+\w+|use\s+\w+::|let\s+mut\s|impl\b|pub\s+(?:fn|struct|enum))/m.test(s))
    return "rust";
  if (/^\s*(?:package\s+\w+|func\s+\w+|import\s+\(|fmt\.)/m.test(s)) return "go";
  if (
    /^\s*(?:def\s+\w+\(|import\s+\w+$|from\s+\w+\s+import|class\s+\w+(?:\(.*\))?:|if __name__)/m.test(
      s,
    )
  )
    return "python";
  if (/<\?php|\$\w+\s*->/.test(s)) return "php";
  if (/^\s*(?:using\s+System|namespace\s+\w+|public\s+(?:static\s+)?class)/m.test(s))
    return "csharp";
  if (
    /\b(?:interface|type)\s+\w+\s*(?:=|\{)|:\s*(?:string|number|boolean)\b|\bas\s+const\b/.test(s)
  ) {
    return /<\/?[A-Z]\w*[\s>/]/.test(s) ? "tsx" : "typescript";
  }
  if (/\b(?:const|let|var|function|export|import)\b[\s\S]*(?:=>|;|\{)|console\.\w+\(/.test(s)) {
    return /<\/?[A-Za-z]\w*[\s>/][\s\S]*>/.test(s) && /return\s*\(?\s*</.test(s)
      ? "jsx"
      : "javascript";
  }
  if (/^[\w.#-][^{\n]*\{\s*[\w-]+\s*:[^;{}]+;/m.test(s)) return "css";
  if (/^---\s*$/m.test(s) || /^(?:[\w-]+:\s*.*\n?){2,}$/.test(s)) return "yaml";
  if (/^#{1,6}\s+\S/m.test(s) && /^(?:[-*]\s|\d+\.\s|```)/m.test(s)) return "markdown";
  return null;
}
