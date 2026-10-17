// Renders ROADMAP.md (repo root): "En curso" and "Planeado" as card grids,
// "Lanzado" grouped by month. Re-renders on every save (import.meta.hot).
// A filter by state (Todo / En curso / Planeado / Lanzado) is kept in the URL hash, every item
// has its own anchor, and the version tag of a launched item links to its changelog entry.
import source from "../../ROADMAP.md?raw";
import { escapeHtml, formatDate, inline, lines, slug } from "../md.js";

const META = /^(.+?)\s+·\s+(\d{4}-\d{2})\s*$/;
const ALL = "todo";

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

function card(item, used, level = 3) {
  let id = slug(item.title.replace(/`/g, "")) || "elemento";
  for (let n = 2; used.has(id); n++) id = `${slug(item.title.replace(/`/g, ""))}-${n}`;
  used.add(id);
  const version = item.version
    ? `<a class="tag" href="/changelog/#${slug(item.version)}">${escapeHtml(item.version)}</a>`
    : "";
  const text = item.text.length ? `<p>${inline(item.text.join(" "))}</p>` : "";
  return `<li class="card" id="${id}"><h${level}><a class="permalink" href="#${id}">${inline(item.title)}</a> ${version}</h${level}>${text}</li>`;
}

function launched(items, used) {
  const months = new Map();
  for (const item of items) {
    const key = item.month ?? "";
    if (!months.has(key)) months.set(key, []);
    months.get(key).push(item);
  }
  return [...months]
    .map(
      ([month, group]) =>
        `<div class="month"><h3 class="month-name">${month ? formatDate(month) : "Sin fecha"}</h3><ul class="cards">${group.map((item) => card(item, used, 4)).join("")}</ul></div>`,
    )
    .join("");
}

const root = document.getElementById("roadmap");
const bar = document.getElementById("roadmap-filter");
let stages = [];

function select(id, { updateHash = true } = {}) {
  const active = stages.some((s) => s.id === id) ? id : ALL;
  for (const el of root.querySelectorAll(".stage")) el.hidden = active !== ALL && el.id !== active;
  for (const button of bar.querySelectorAll("button")) {
    button.setAttribute("aria-pressed", String(button.dataset.stage === active));
  }
  if (updateHash) {
    history.replaceState(null, "", active === ALL ? location.pathname : `#${active}`);
  }
}

function markTarget() {
  for (const el of root.querySelectorAll(".is-target")) el.classList.remove("is-target");
  const target = location.hash
    ? document.getElementById(decodeURIComponent(location.hash.slice(1)))
    : null;
  if (target?.classList.contains("card")) {
    target.classList.add("is-target");
    target.scrollIntoView();
  }
}

function render(md) {
  stages = parse(md).map((s) => ({ ...s, id: slug(s.name) }));
  const used = new Set(stages.map((s) => s.id));
  root.innerHTML = stages
    .map((s) => {
      const content =
        s.id === "lanzado"
          ? launched(s.items, used)
          : `<ul class="cards">${s.items.map((item) => card(item, used)).join("")}</ul>`;
      return `<section class="stage stage-${s.id}" id="${s.id}"><h2>${escapeHtml(s.name)}</h2>${content}</section>`;
    })
    .join("");

  const total = stages.reduce((n, s) => n + s.items.length, 0);
  bar.innerHTML = [[ALL, "Todo", total], ...stages.map((s) => [s.id, s.name, s.items.length])]
    .map(
      ([id, name, count]) =>
        `<button type="button" class="chip" data-stage="${id}" aria-pressed="false">${escapeHtml(name)} · ${count}</button>`,
    )
    .join("");

  const hash = decodeURIComponent(location.hash.slice(1));
  select(stages.some((s) => s.id === hash) ? hash : ALL, { updateHash: false });
  markTarget();
}

bar.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-stage]");
  if (button) select(button.dataset.stage);
});

window.addEventListener("hashchange", () => {
  const hash = decodeURIComponent(location.hash.slice(1));
  if (stages.some((s) => s.id === hash)) select(hash, { updateHash: false });
  else if (document.getElementById(hash)?.classList.contains("card"))
    select(ALL, { updateHash: false });
  markTarget();
});

render(source);

if (import.meta.hot) {
  import.meta.hot.accept("../../ROADMAP.md?raw", (mod) => mod && render(mod.default));
}
