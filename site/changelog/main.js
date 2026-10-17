// Renders CHANGELOG.md (repo root) as the changelog page. The dev server
// re-renders it on every save of the Markdown file (import.meta.hot).
// A "Ver" list filters the page down to one version; every version keeps its own anchor.
import source from "../../CHANGELOG.md?raw";
import { escapeHtml, formatDate, inline, lines, slug } from "../md.js";

const ALL = "todas";

/** Splits the file into versions: "## <version> · <date>" + body lines. */
function parse(md) {
  const versions = [];
  for (const line of lines(md)) {
    const head = line.match(/^## (.+?)(?:\s+·\s+(\d{4}-\d{2}-\d{2}))?\s*$/);
    if (head) versions.push({ name: head[1], date: head[2] ?? null, lines: [] });
    else versions.at(-1)?.lines.push(line);
  }
  return versions;
}

function body(source) {
  let html = "";
  let list = false;
  let para = [];
  const closePara = () => {
    if (para.length) html += `<p>${inline(para.join(" "))}</p>`;
    para = [];
  };
  const closeList = () => {
    if (list) html += "</ul>";
    list = false;
  };
  for (const line of source) {
    const group = line.match(/^### (.+)$/);
    const item = line.match(/^[-*] (.+)$/);
    if (group) {
      closePara();
      closeList();
      html += `<h3>${inline(group[1])}</h3>`;
    } else if (item) {
      closePara();
      if (!list) html += "<ul>";
      list = true;
      html += `<li>${inline(item[1])}</li>`;
    } else if (line.trim() === "") {
      closePara();
      closeList();
    } else {
      closeList();
      para.push(line.trim());
    }
  }
  closePara();
  closeList();
  return html;
}

const entries = document.getElementById("entries");
const bar = document.getElementById("changelog-filter");
const status = document.getElementById("changelog-status");
let current = ALL;

function show(id) {
  const items = [...entries.querySelectorAll(".entry")];
  current = items.some((el) => el.id === id) ? id : ALL;
  for (const el of items) el.hidden = current !== ALL && el.id !== current;
  const select = bar.querySelector("select");
  if (select) select.value = current;
  const visible = items.filter((el) => !el.hidden).length;
  status.textContent = `Mostrando ${visible} de ${items.length} ${items.length === 1 ? "versión" : "versiones"}.`;
}

function render(md) {
  const versions = parse(md);
  entries.innerHTML = versions
    .map((v) => {
      const unreleased = v.date === null;
      const title = unreleased ? escapeHtml(v.name) : `Fossil ${escapeHtml(v.name)}`;
      const meta = unreleased
        ? '<span class="badge">Próxima versión</span>'
        : `<time datetime="${v.date}">${formatDate(v.date)}</time>`;
      const id = escapeHtml(slug(v.name));
      return `<article class="entry" id="${id}">
  <div class="entry-meta"><h2><a href="#${id}">${title}</a></h2>${meta}<span class="platform">Escritorio · Windows 10/11 (64 bits)</span></div>
  <div class="entry-body">${body(v.lines)}</div>
</article>`;
    })
    .join("");

  bar.innerHTML = `<label for="changelog-version">Ver</label>
<select id="changelog-version" class="select">
  <option value="${ALL}">Todas las versiones</option>
  ${versions.map((v) => `<option value="${escapeHtml(slug(v.name))}">${escapeHtml(v.name)}</option>`).join("")}
</select>`;

  show(current);
  const target = location.hash
    ? document.getElementById(decodeURIComponent(location.hash.slice(1)))
    : null;
  if (target) target.scrollIntoView();
}

bar.addEventListener("change", (event) => {
  if (event.target.matches("select")) show(event.target.value);
});

render(source);

if (import.meta.hot) {
  import.meta.hot.accept("../../CHANGELOG.md?raw", (mod) => mod && render(mod.default));
}
