import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Button } from "./button";

afterEach(cleanup);

describe("Button", () => {
  it("renders its children with type=button and the primary class by default", () => {
    render(<Button>Guardar</Button>);
    const button = screen.getByRole("button", { name: "Guardar" });
    expect(button.getAttribute("type")).toBe("button");
    expect(button.className).toContain("fui-button--primary");
  });

  it("applies the secondary variant class", () => {
    render(<Button variant="secondary">Cancelar</Button>);
    expect(screen.getByRole("button").className).toContain("fui-button--secondary");
  });

  it("forwards native props such as a custom type", () => {
    render(<Button type="submit">Enviar</Button>);
    expect(screen.getByRole("button").getAttribute("type")).toBe("submit");
  });

  it("fires onClick when enabled", () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Guardar</Button>);
    fireEvent.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("is disabled and does not fire onClick when disabled", () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Guardar
      </Button>,
    );
    const button = screen.getByRole("button");
    expect((button as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });
});
