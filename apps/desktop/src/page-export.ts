import type { ObjectId } from "./bindings";
import { commands } from "./bindings";

/** Windows-safe `.md` file name, same rules as the mirror's `safe_name` (#21). */
export function markdownFileName(title: string, fallback: string): string {
  const cleaned = Array.from(title, (ch) => {
    const code = ch.charCodeAt(0);
    return code < 32 || code === 127 || '<>:"/\\|?*'.includes(ch) ? "-" : ch;
  })
    .slice(0, 120)
    .join("")
    .trim()
    .replace(/[. ]+$/, "");
  const name = cleaned === "" ? fallback : cleaned;
  const stem = (name.split(".")[0] ?? "").trimEnd().toUpperCase();
  const reserved = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/.test(stem);
  return `${reserved ? "_" : ""}${name}.md`;
}

/**
 * Downloads the page as Markdown (#126): the same content the vault mirror
 * writes, frontmatter and body included. Returns `false` when the export failed.
 */
export async function exportObjectMarkdown(
  id: ObjectId,
  title: string,
  fallback: string,
): Promise<boolean> {
  const result = await commands.objectExportMarkdown(id);
  if (result.status === "error") return false;
  const url = URL.createObjectURL(new Blob([result.data], { type: "text/markdown;charset=utf-8" }));
  const link = Object.assign(document.createElement("a"), {
    href: url,
    download: markdownFileName(title, fallback),
  });
  link.click();
  URL.revokeObjectURL(url);
  return true;
}

/**
 * Exports the page to PDF through the WebView2 print dialog (#10), where the
 * user picks "Save as PDF". The page always prints in the light theme; the
 * shell theme comes back as soon as the (blocking) dialog closes. The sidebar
 * and page controls hide themselves with Tailwind's `print:` variant.
 */
export function printObjectPdf(): void {
  const root = document.documentElement;
  const previous = root.dataset.theme;
  root.dataset.theme = "light";
  try {
    window.print();
  } finally {
    if (previous === undefined) delete root.dataset.theme;
    else root.dataset.theme = previous;
  }
}
