// Tiny Markdown helpers shared by the changelog and roadmap pages.

export const escapeHtml = (s) =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

/** Inline Markdown: `code`, **bold** and [text](url). */
export function inline(text) {
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2">$1</a>');
}

/** Anchor id: lowercase, no accents, dots kept ("0.1.1-alpha.2", "matematicas-diagramas"). */
export const slug = (text) =>
  text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9.]+/g, "-")
    .replace(/^-+|-+$/g, "");

/** Drops the authoring notes (HTML comments) and splits into lines. */
export const lines = (md) => md.replace(/<!--[\s\S]*?-->/g, "").split(/\r?\n/);

/** "2026-10" or "2026-10-14" in es-MX: "octubre de 2026" / "14 de octubre de 2026". */
export function formatDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  const options = d
    ? { year: "numeric", month: "long", day: "numeric" }
    : { year: "numeric", month: "long" };
  const text = new Date(y, m - 1, d || 1).toLocaleDateString("es-MX", options);
  return text.charAt(0).toUpperCase() + text.slice(1);
}
