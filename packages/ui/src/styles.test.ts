import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// import.meta.dirname avoids Vite's static transform of
// `new URL(..., import.meta.url)`, which breaks under Vitest's module runner.
const here = import.meta.dirname ?? process.cwd();
const read = (path: string): string => readFileSync(join(here, path), "utf8");

const tokensCss = read("../styles/tokens.css");
const fontsCss = read("../styles/fonts.css");
const componentsCss = read("../styles/components.css");

/** Tokens required by docs/DESIGN.md, defined for both light and dark themes. */
const REQUIRED_TOKENS = [
  "--bg",
  "--bg-elevated",
  "--fg",
  "--fg-muted",
  "--border",
  "--accent",
  "--danger",
  "--success",
  "--warning",
] as const;

const FONT_FILES = [
  "InterVariable.woff2",
  "InterVariable-Italic.woff2",
  "JetBrainsMono-Variable.woff2",
  "JetBrainsMono-VariableItalic.woff2",
] as const;

describe("tokens.css", () => {
  it("defines every semantic token for light and dark", () => {
    for (const token of REQUIRED_TOKENS) {
      // light-dark(light, dark) resolves per used color-scheme.
      expect(tokensCss, token).toMatch(new RegExp(`${token}:\\s*light-dark\\(`));
    }
  });

  it("follows the OS theme and supports explicit data-theme overrides", () => {
    expect(tokensCss).toContain("color-scheme: light dark");
    expect(tokensCss).toContain(':root[data-theme="light"]');
    expect(tokensCss).toContain(':root[data-theme="dark"]');
  });
});

describe("fonts.css", () => {
  it("self-hosts Inter and JetBrains Mono without any CDN URL", () => {
    expect(fontsCss).not.toMatch(/https?:\/\//);
    expect(fontsCss).toContain('font-family: "InterVariable"');
    expect(fontsCss).toContain('font-family: "JetBrainsMonoVariable"');
  });

  it("ships the woff2 files and their OFL licenses", () => {
    expect(fontsCss).toContain("OFL-*.txt");
    for (const file of FONT_FILES) {
      expect(fontsCss, `not referenced: ${file}`).toContain(file);
    }
    for (const file of [...FONT_FILES, "OFL-Inter.txt", "OFL-JetBrainsMono.txt"]) {
      // Throws if the file is missing from the package.
      readFileSync(join(here, "..", "fonts", file));
    }
  });
});

describe("components.css", () => {
  it("shows a visible focus ring for Button and Input", () => {
    expect(componentsCss).toMatch(/\.fui-button:focus-visible/);
    expect(componentsCss).toMatch(/\.fui-input:focus-visible/);
    expect(componentsCss).toMatch(/outline:\s*2px solid var\(--accent\)/);
  });

  it("respects prefers-reduced-motion", () => {
    expect(componentsCss).toMatch(/prefers-reduced-motion:\s*reduce/);
  });
});
