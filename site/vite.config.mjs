// Public site (auralisgo.com): landing, roadmap and changelog. The roadmap and
// changelog render ROADMAP.md / CHANGELOG.md from the repo root and update on
// every save. Every index.html under site/ is a page of the build.
//   dev:   apps/desktop/node_modules/.bin/vite --config site/vite.config.mjs
//   build: apps/desktop/node_modules/.bin/vite build --config site/vite.config.mjs
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const site = (path) => fileURLToPath(new URL(path, import.meta.url));
const pages = ["index.html", "roadmap/index.html", "changelog/index.html"].filter((p) =>
  existsSync(site(p)),
);

export default {
  root: site("."),
  server: { host: "127.0.0.1", port: 1450, strictPort: true, fs: { allow: [site("..")] } },
  build: {
    outDir: site("dist"),
    emptyOutDir: true,
    rollupOptions: { input: Object.fromEntries(pages.map((p) => [p, site(p)])) },
  },
};
