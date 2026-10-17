import { inline, lines, slug } from "./md.js";

const cols = (r) => r.replace(/^\s*\||\|\s*$/g, "").split("|");
const cell = (t, c, a = "") => `<${t}${a}>${inline(c.trim())}</${t}>`;
const row = (r, t, a) => cols(r).reduce((s, c) => s + cell(t, c, a), "");
const isSep = (r) => /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(r ?? "");
const item = (it) => inline(it.replace(/^[-*] |\s*\n\s*/g, " ").trim());
const join = (ls, re) => inline(ls.reduce((s, l) => `${s} ${l.replace(re, "").trim()}`, "").trim());
const linkRe = /\]\((?!https?:|#|mailto:)([^)\s]+)\)/g;

export function renderMarkdown(md, opt = {}) {
  const res = typeof opt === "string" ? (h) => new URL(h, opt).href : (opt.resolve ?? ((h) => h));
  const text = md.replace(/\r\n/g, "\n").replace(linkRe, (_, h) => `](${res(h)})`);
  const blocks = text.trim().split(/\n(?=#{1,3} )|\n\s*\n/);
  const used = new Map();
  return blocks
    .map((blk) => {
      const ls = lines(blk);
      const h = ls[0].match(/^(#{1,3}) (.+)$/);
      if (h) {
        const b = slug(h[2].replace(/`/g, "")) || "seccion";
        const n = (used.get(b) || 0) + 1;
        used.set(b, n);
        const id = n > 1 ? `${b}-${n}` : b;
        return `<h${h[1].length} id="${id}">${inline(h[2])}</h${h[1].length}>`;
      }
      if (ls[0].startsWith(">")) return `<blockquote><p>${join(ls, /^>\s?/)}</p></blockquote>`;
      if (ls[0].trimStart().startsWith("|") && isSep(ls[1])) {
        const th = row(ls[0], "th", ' scope="col"');
        const tr = ls.slice(2).reduce((s, r) => `${s}<tr>${row(r, "td")}</tr>`, "");
        const tb = `<table><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table>`;
        return `<div class="table-scroll">${tb}</div>`;
      }
      if (/^[-*] /.test(ls[0])) {
        const li = blk.split(/\n(?=[-*] )/).reduce((s, it) => `${s}<li>${item(it)}</li>`, "");
        return `<ul>${li}</ul>`;
      }
      return `<p>${join(ls, /^/)}</p>`;
    })
    .join("\n");
}
