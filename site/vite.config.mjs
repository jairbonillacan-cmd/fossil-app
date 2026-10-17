// Public site (auralisgo.com): landing, roadmap and changelog. The roadmap and
// changelog render ROADMAP.md / CHANGELOG.md from the repo root and update on
// every save. Every index.html under site/ is a page of the build.
//   dev:   apps/desktop/node_modules/.bin/vite --config site/vite.config.mjs
//   build: apps/desktop/node_modules/.bin/vite build --config site/vite.config.mjs
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderMarkdown } from "./render-md.js";

// The only place that knows the public domain. auralisgo.com is provisional
// (ADR-0017): if it changes, change it here and nowhere else.
const SITE_URL = "https://auralisgo.com";
const REPO_URL = "https://github.com/jairbonillacan-cmd/fossil-app";
const CONTACT_EMAIL = "hello@jairbonilla.com";

const site = (path) => fileURLToPath(new URL(path, import.meta.url));
const pages = [
  "index.html",
  "descarga/index.html",
  "roadmap/index.html",
  "changelog/index.html",
  "privacidad/index.html",
  "404.html",
].filter((p) => existsSync(site(p)));
const pagePath = (p) => `/${p.replace(/index\.html$/, "")}`;
const mdRe = /<!--MARKDOWN:(docs\/[A-Za-z0-9_.-]+\.md)-->/g;
const blob = `${REPO_URL}/blob/main/`;
const md = (_, f) => renderMarkdown(readFileSync(site(`../${f}`), "utf8"), blob + f);
const varRe = /__(SITE_URL|PAGE_URL|REPO_URL|CONTACT_EMAIL)__/g;

/** Fills __SITE_URL__ / __PAGE_URL__ in the HTML and emits sitemap.xml and robots.txt. */
function seo() {
  return {
    name: "fossil-site-seo",
    transformIndexHtml: {
      order: "pre",
      handler(html, ctx) {
        const PAGE_URL = SITE_URL + pagePath(ctx.path ?? "");
        const v = { SITE_URL, PAGE_URL, REPO_URL, CONTACT_EMAIL };
        return html.replace(mdRe, md).replace(varRe, (_, k) => v[k]);
      },
    },
    handleHotUpdate({ file, server }) {
      if (file.endsWith("PRIVACY.md")) server.ws.send({ type: "full-reload" });
    },
    generateBundle() {
      const loc = (p) => `  <url><loc>${SITE_URL}${pagePath(p)}</loc></url>`;
      const urls = pages.filter((p) => p !== "404.html").map(loc);
      this.emitFile({
        type: "asset",
        fileName: "sitemap.xml",
        source: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`,
      });
      this.emitFile({
        type: "asset",
        fileName: "robots.txt",
        source: `User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}/sitemap.xml\n`,
      });
    },
  };
}

export default {
  root: site("."),
  plugins: [seo()],
  server: { host: "127.0.0.1", port: 1450, strictPort: true, fs: { allow: [site("..")] } },
  build: {
    outDir: site("dist"),
    emptyOutDir: true,
    rollupOptions: { input: Object.fromEntries(pages.map((p) => [p, site(p)])) },
  },
};
