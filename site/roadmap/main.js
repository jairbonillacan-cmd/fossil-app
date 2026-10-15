// Renders ROADMAP.md (repo root): "En curso" and "Planeado" as card grids,
// "Lanzado" grouped by month. Re-renders on every save (import.meta.hot).
import source from "../../ROADMAP.md?raw";
import { escapeHtml, formatDate, inline, lines } from "../md.js";

const META = /^(.+?)\s+·\s+(\d{4}-\d{2})\s*$/;

/** Sections ("## ...") with their items ("### title" + optional meta + text). */
function parse(md) {
  const sections = [];
  for (const line of lines(md)) {
    const section = line.match(/^## (.+)$/);
    const item = line.match(/^### (.+)$/);
    const current = sections.at(-1);
    if (section) {
      sections.push({ name: section[1].trim(), items: [] });
    } else if (item && current) {
      current.items.push({ title: item[1].trim(), version: null, month: null, text: [] });
    } else if (line.trim() !== "" && current?.items.length) {
      const last = current.items.at(-1);
      const meta = last.text.length === 0 && last.version === null ? line.match(META) : null;
      if (meta) [, last.version, last.month] = meta;
      else last.text.push(line.trim());
    }
  }
  return sections;
}

function card(item, level = 3) {
  const version = item.version ? `<span class="tag">${escapeHtml(item.version)}</span>` : "";
  const text = item.text.length ? `<p>${inline(item.text.join(" "))}</p>` : "";
  return `<li class="card"><h${level}>${inline(item.title)} ${version}</h${level}>${text}</li>`;
}

function launched(items) {
  const months = new Map();
  for (const item of items) {
    const key = item.month ?? "";
    if (!months.has(key)) months.set(key, []);
    months.get(key).push(item);
  }
  return [...months]
    .map(
      ([month, group]) =>
        `<div class="month"><h3 class="month-name">${month ? formatDate(month) : "Sin fecha"}</h3><ul class="cards">${group.map((item) => card(item, 4)).join("")}</ul></div>`,
    )
    .join("");
}

function render(md) {
  document.getElementById("roadmap").innerHTML = parse(md)
    .map((s) => {
      const id = s.name
        .toLowerCase()
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .replace(/[^a-z0-9]+/g, "-");
      const content =
        id === "lanzado"
          ? launched(s.items)
          : `<ul class="cards">${s.items.map((item) => card(item)).join("")}</ul>`;
      return `<section class="stage stage-${id}" id="${id}"><h2>${escapeHtml(s.name)}</h2>${content}</section>`;
    })
    .join("");
}

render(source);

if (import.meta.hot) {
  import.meta.hot.accept("../../ROADMAP.md?raw", (mod) => mod && render(mod.default));
}
