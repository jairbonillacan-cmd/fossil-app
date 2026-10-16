// Renders CHANGELOG.md (repo root) as the changelog page. The dev server
// re-renders it on every save of the Markdown file (import.meta.hot).
import source from "../../CHANGELOG.md?raw";
import { escapeHtml, formatDate, inline, lines } from "../md.js";

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

function render(md) {
  document.getElementById("entries").innerHTML = parse(md)
    .map((v) => {
      const unreleased = v.date === null;
      const title = unreleased ? escapeHtml(v.name) : `Fossil ${escapeHtml(v.name)}`;
      const meta = unreleased
        ? '<span class="badge">Próxima versión</span>'
        : `<time datetime="${v.date}">${formatDate(v.date)}</time>`;
      const id = escapeHtml(v.name.toLowerCase().replace(/[^a-z0-9.-]+/g, "-"));
      return `<article class="entry" id="${id}">
  <div class="entry-meta"><h2><a href="#${id}">${title}</a></h2>${meta}<span class="platform">Escritorio · Windows 10/11 (64 bits)</span></div>
  <div class="entry-body">${body(v.lines)}</div>
</article>`;
    })
    .join("");
}

render(source);

if (import.meta.hot) {
  import.meta.hot.accept("../../CHANGELOG.md?raw", (mod) => mod && render(mod.default));
}
