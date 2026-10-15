import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Input } from "./input";

afterEach(cleanup);

describe("Input", () => {
  it("renders a textbox with the base class, placeholder and type=text", () => {
    render(<Input placeholder="Buscar" />);
    const input = screen.getByRole("textbox");
    expect(input.className).toContain("fui-input");
    expect(input.getAttribute("placeholder")).toBe("Buscar");
    expect(input.getAttribute("type")).toBe("text");
  });

  it("forwards a custom type", () => {
    render(<Input type="search" aria-label="buscar" />);
    expect(screen.getByRole("searchbox").getAttribute("type")).toBe("search");
  });

  it("updates its value when the user types", () => {
    render(<Input aria-label="nombre" />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "Acme" } });
    expect((input as HTMLInputElement).value).toBe("Acme");
  });

  it("marks invalid state with aria-invalid only when invalid", () => {
    const { rerender } = render(<Input invalid aria-label="correo" />);
    expect(screen.getByRole("textbox").getAttribute("aria-invalid")).toBe("true");
    rerender(<Input aria-label="correo" />);
    expect(screen.getByRole("textbox").getAttribute("aria-invalid")).toBeNull();
  });

  it("can be disabled", () => {
    render(<Input disabled aria-label="correo" />);
    expect((screen.getByRole("textbox") as HTMLInputElement).disabled).toBe(true);
  });
});
