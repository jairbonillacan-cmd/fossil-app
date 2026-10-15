import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const svgPath = resolve(import.meta.dirname, "../app-icon.svg");

describe("app-icon.svg (#69)", () => {
  it("aligns every rect attribute (x, y, width, height, rx) to the 64-unit grid for crisp 16/32 px scaling", () => {
    const svg = readFileSync(svgPath, "utf8");
    const rects = [...svg.matchAll(/<rect\b([^>]*)\/>/g)].map((m) => m[1] ?? "");
    expect(rects.length).toBeGreaterThanOrEqual(5);

    for (const attrs of rects) {
      for (const name of ["x", "y", "width", "height", "rx"]) {
        const match = attrs.match(new RegExp(`\\b${name}="(\\d+)"`));
        if (match) {
          const val = Number(match[1]);
          expect(val % 64, `${name}="${val}" must be a multiple of 64`).toBe(0);
        }
      }
    }
  });

  it("includes rounded corners and a subtle inner border around the black square for dark title bars", () => {
    const svg = readFileSync(svgPath, "utf8");
    expect(svg).toMatch(/<rect\b[^>]*\brx="192"[^>]*\bfill="#333333"/);
    expect(svg).toMatch(
      /<rect\b[^>]*\bx="64"\s+y="64"\s+width="896"\s+height="896"\s+rx="128"\s+fill="#000000"/,
    );
  });
});
