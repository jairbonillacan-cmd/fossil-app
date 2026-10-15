import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Wordmark } from "./wordmark";

afterEach(cleanup);

describe("Wordmark", () => {
  it("renders the Fossil brand name", () => {
    render(<Wordmark />);
    expect(screen.getByText("Fossil")).not.toBeNull();
  });

  it("applies the wordmark class and merges a custom className", () => {
    render(<Wordmark className="extra" />);
    const el = screen.getByText("Fossil");
    expect(el.className).toContain("fui-wordmark");
    expect(el.className).toContain("extra");
  });
});
