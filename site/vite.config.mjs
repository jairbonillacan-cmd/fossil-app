// Public site (auralisgo.com): landing, roadmap and changelog. The roadmap and
// changelog render ROADMAP.md / CHANGELOG.md from the repo root and update on
// every save. Every index.html under site/ is a page of the build.
//   dev:   apps/desktop/node_modules/.bin/vite --config site/vite.config.mjs
//   build: apps/desktop/node_modules/.bin/vite build --config site/vite.config.mjs
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

// The only place that knows the public domain. auralisgo.com is provisional
// (ADR-0017): if it changes, change it here and nowhere else.
const SITE_URL = "https://auralisgo.com";

const site = (path) => fileURLToPath(new URL(path, import.meta.url));
const pages = ["index.html", "roadmap/index.html", "changelog/index.html"].filter((p) =>
  existsSync(site(p)),
);
const pagePath = (p) => `/${p.replace(/index\.html$/, "")}`;

/** Fills __SITE_URL__ / __PAGE_URL__ in the HTML and emits sitemap.xml and robots.txt. */
function seo() {
  return {
    name: "fossil-site-seo",
    transformIndexHtml: {
      order: "pre",
      handler(html, ctx) {
        const path = (ctx.path ?? "/").replace(/index\.html$/, "");
        return html
          .replaceAll("__SITE_URL__", SITE_URL)
          .replaceAll("__PAGE_URL__", SITE_URL + path);
      },
    },
    generateBundle() {
      const urls = pages.map((p) => `  <url><loc>${SITE_URL}${pagePath(p)}</loc></url>`);
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
