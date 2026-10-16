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

/** rgba(r, g, b, a) channels found in a declaration; a light-dark() pair yields two. */
const rgbaChannels = (declaration: string): number[][] =>
  [...declaration.matchAll(/rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)/g)].map(
    (m) => [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])],
  );

/** [light, dark] rgba channels of a light-dark() pair; fails the test if either is missing. */
const rgbaPair = (declaration: string): [number[], number[]] => {
  const light = rgbaChannels(declaration)[0];
  const dark = rgbaChannels(declaration)[1];
  if (light === undefined || dark === undefined) {
    throw new Error(`expected light-dark(rgba, rgba), got: ${declaration}`);
  }
  return [light, dark];
};

/** Alpha channel of an rgba quadruple; fails the test if missing. */
const alphaOf = (channels: number[]): number => {
  const alpha = channels[3];
  if (alpha === undefined) throw new Error(`rgba alpha missing in: ${channels.join(", ")}`);
  return alpha;
};

/** Value of a token declaration in the given CSS text; fails the test if absent. */
const tokenValue = (css: string, token: string): string => {
  const value = css.match(new RegExp(`${token}:\\s*([^;]+);`))?.[1];
  if (value === undefined) throw new Error(`token ${token} not found`);
  return value;
};

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

describe("scrollbar tokens (spec R1.5, r1-scrollbar)", () => {
  it("defines a rest and a hover/active thumb token with light-dark()", () => {
    expect(tokensCss).toMatch(/--scrollbar-thumb:\s*light-dark\(/);
    expect(tokensCss).toMatch(/--scrollbar-thumb-strong:\s*light-dark\(/);
  });

  it("thumbs are black on light and white on dark (monochrome palette)", () => {
    for (const token of ["--scrollbar-thumb", "--scrollbar-thumb-strong"]) {
      const [light, dark] = rgbaPair(tokenValue(tokensCss, token));
      for (const channel of light.slice(0, 3)) {
        expect(channel, `${token} light thumb must be black-ish`).toBeLessThan(64);
      }
      for (const channel of dark.slice(0, 3)) {
        expect(channel, `${token} dark thumb must be white-ish`).toBeGreaterThan(191);
      }
    }
  });

  it("rest opacity is <= 0.3 and hover/active opacity is >= 0.8", () => {
    const alphas = (token: string): number[] =>
      rgbaPair(tokenValue(tokensCss, token)).map((channels) => alphaOf(channels));
    for (const alpha of alphas("--scrollbar-thumb")) {
      expect(alpha, "rest thumb").toBeLessThanOrEqual(0.3);
    }
    for (const alpha of alphas("--scrollbar-thumb-strong")) {
      expect(alpha, "hover/active thumb").toBeGreaterThanOrEqual(0.8);
    }
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
