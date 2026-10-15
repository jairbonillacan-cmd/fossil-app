import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AppIcon } from "./app-icon";

afterEach(cleanup);

describe("AppIcon", () => {
  it("renders the provisional F glyph with the icon class", () => {
    render(<AppIcon />);
    const el = screen.getByText("F");
    expect(el.className).toContain("fui-app-icon");
  });

  it("is hidden from assistive tech by default", () => {
    render(<AppIcon />);
    expect(screen.getByText("F").getAttribute("aria-hidden")).toBe("true");
  });

  it("allows overriding the accessibility attributes", () => {
    render(<AppIcon aria-hidden={undefined} role="img" aria-label="Fossil" />);
    const el = screen.getByRole("img", { name: "Fossil" });
    expect(el.getAttribute("aria-hidden")).toBeNull();
  });
});
