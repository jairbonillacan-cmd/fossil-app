import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// import.meta.dirname avoids Vite's static transform of
// `new URL(..., import.meta.url)`, which breaks under Vitest's module runner.
const here = import.meta.dirname ?? process.cwd();
const appCss = readFileSync(join(here, "styles.css"), "utf8");
const tokensCss = readFileSync(join(here, "../../../packages/ui/styles/tokens.css"), "utf8");

describe("global scrollbar styles (spec R1.5, r1-scrollbar)", () => {
  it("style every scrollable region through the shared tokens", () => {
    expect(appCss).toMatch(/scrollbar-width:\s*thin/);
    expect(appCss).toMatch(/scrollbar-color:\s*var\(--scrollbar-thumb\)\s+transparent/);
    expect(appCss).toMatch(/::-webkit-scrollbar\b/);
    expect(appCss).toMatch(/::-webkit-scrollbar-thumb\s*\{[^}]*var\(--scrollbar-thumb\)/);
    expect(appCss).toMatch(
      /(:hover|:active|\[data-scrolling\])::-webkit-scrollbar-thumb[^{]*\{[^}]*var\(--scrollbar-thumb-strong\)/,
    );
  });

  it("never use raw colors: every scrollbar color comes from a token", () => {
    for (const line of appCss.split("\n")) {
      if (!/scrollbar/i.test(line)) continue;
      expect(line, `raw color in scrollbar rule: ${line.trim()}`).not.toMatch(
        /#[0-9a-fA-F]{3,8}\b|rgba?\(/,
      );
    }
  });

  it("consume tokens defined in packages/ui for both themes", () => {
    expect(tokensCss).toMatch(/--scrollbar-thumb:\s*light-dark\(/);
    expect(tokensCss).toMatch(/--scrollbar-thumb-strong:\s*light-dark\(/);
  });

  it("transition 120-200 ms ease-out and respect prefers-reduced-motion", () => {
    expect(appCss).toMatch(/transition:\s*background-color\s+(1[2-9]\d|200)ms\s+ease-out/);
    expect(appCss).toMatch(/prefers-reduced-motion:\s*reduce/);
  });
});
