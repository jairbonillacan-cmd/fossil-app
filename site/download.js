const RELEASES_API =
  "https://api.github.com/repos/jairbonillacan-cmd/fossil-app/releases?per_page=10";
const RELEASES_PAGE = "https://github.com/jairbonillacan-cmd/fossil-app/releases";
const DOWNLOAD_PREFIX = "https://github.com/jairbonillacan-cmd/fossil-app/releases/download/";

const formatSize = (bytes) => {
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes <= 0) return "";
  const mb = bytes / (1024 * 1024);
  return `${mb >= 10 ? Math.round(mb) : Math.round(mb * 10) / 10} MB`;
};

const formatDate = (iso) => {
  const date = new Date(iso ?? "");
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("es-MX", { dateStyle: "long" }).format(date);
};

const isTrial = (release) =>
  release.prerelease === true || /-(alpha|beta|rc)(\.|$)/i.test(release.tag_name ?? "");

const applyFallback = () => {
  for (const link of document.querySelectorAll("[data-download]")) {
    link.href = RELEASES_PAGE;
    link.textContent = "Ver versiones";
    link.removeAttribute("aria-label");
  }
  for (const el of document.querySelectorAll("[data-download-meta]")) {
    el.hidden = true;
    el.textContent = "";
  }
  for (const el of document.querySelectorAll("[data-download-note]")) {
    el.hidden = true;
  }
};

const applyRelease = (release, asset) => {
  const version = (release.name || release.tag_name || "").trim() || "Fossil";
  const size = formatSize(asset.size);
  const date = formatDate(release.published_at ?? release.created_at);
  const trial = isTrial(release);

  for (const link of document.querySelectorAll("[data-download]")) {
    link.href = asset.browser_download_url;
    link.textContent = "Descargar para Windows";
    link.setAttribute(
      "aria-label",
      `Descargar para Windows: Fossil ${version}${size ? `, ${size}` : ""}`,
    );
  }
  for (const meta of document.querySelectorAll("[data-download-meta]")) {
    meta.hidden = false;
    meta.textContent = "";
    const strong = document.createElement("strong");
    strong.textContent = `Fossil ${version}`;
    meta.append(strong);
    for (const part of [size, date]) {
      if (part) meta.append(document.createTextNode(` · ${part}`));
    }
    if (trial) {
      const badge = document.createElement("span");
      badge.className = "dl-badge";
      badge.textContent = "Versión de prueba";
      meta.append(document.createTextNode(" "), badge);
    }
  }
  for (const note of document.querySelectorAll("[data-download-note]")) {
    note.hidden = !trial;
  }
};

const loadRelease = async () => {
  let release = null;
  let asset = null;
  try {
    const res = await fetch(RELEASES_API, { headers: { Accept: "application/vnd.github+json" } });
    if (!res.ok) throw new Error(`releases ${res.status}`);
    const releases = await res.json();
    if (!Array.isArray(releases)) throw new Error("releases payload");
    release = releases.find((r) => r && r.draft === false) ?? null;
    asset =
      release && Array.isArray(release.assets)
        ? (release.assets.find((a) => a && typeof a.name === "string" && /\.exe$/i.test(a.name)) ??
          null)
        : null;
    if (
      !release ||
      !asset ||
      typeof asset.browser_download_url !== "string" ||
      !asset.browser_download_url.startsWith(DOWNLOAD_PREFIX)
    ) {
      applyFallback();
      return;
    }
  } catch {
    applyFallback();
    return;
  }
  applyRelease(release, asset);
};

void loadRelease();
