import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { commands } from "./bindings";
import i18next from "./i18n";
import { ShellSettings } from "./shell-settings";

vi.mock("./bindings", () => ({
  commands: { appInfo: vi.fn() },
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
  delete document.documentElement.dataset.theme;
  delete document.documentElement.dataset.density;
  void i18next.changeLanguage("es-MX");
});

beforeEach(() => {
  vi.mocked(commands.appInfo).mockReset();
  vi.mocked(commands.appInfo).mockResolvedValue({
    status: "ok",
    data: { version: "0.0.1", data_dir: "C:\\Data" },
  });
});

/** Opener button + dialog, as the sidebar mounts it. */
function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Abrir ajustes
      </button>
      <ShellSettings open={open} vaultName="Notas" onClose={() => setOpen(false)} />
    </>
  );
}

describe("ShellSettings (#31)", () => {
  it("persists theme, density and language and shows AppInfoPanel inside settings", async () => {
    const onClose = vi.fn();
    render(<ShellSettings open={true} vaultName="Notas" onClose={onClose} />);
    expect(await screen.findByText(/Versión 0\.0\.1/)).not.toBeNull();
    expect(screen.getByText("Notas")).not.toBeNull();
    fireEvent.click(screen.getByText("Oscuro"));
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem("fossil.theme")).toBe("dark");
    fireEvent.click(screen.getByText("Sistema"));
    expect(document.documentElement.dataset.theme).toBeUndefined();
    fireEvent.click(screen.getByText("Compacta"));
    expect(document.documentElement.dataset.density).toBe("compact");
    expect(localStorage.getItem("fossil.density")).toBe("compact");
    fireEvent.click(screen.getByText("English"));
    expect(localStorage.getItem("fossil.language")).toBe("en");
    expect(document.documentElement.lang).toBe("en");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders nothing and calls no IPC while closed", () => {
    render(<ShellSettings open={false} vaultName="Notas" onClose={() => {}} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(commands.appInfo).not.toHaveBeenCalled();
  });

  it("moves focus in, keeps Tab inside, closes on backdrop click and returns focus", async () => {
    render(<Harness />);
    const opener = screen.getByRole("button", { name: "Abrir ajustes" });
    opener.focus();
    fireEvent.click(opener);
    const dialog = await screen.findByRole("dialog");
    const close = screen.getByRole("button", { name: "Cerrar" });
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(window, { key: "Tab", shiftKey: true });
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).not.toBe(close);
    const backdrop = dialog.parentElement;
    expect(backdrop).not.toBeNull();
    if (backdrop !== null) fireEvent.mouseDown(backdrop);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("keeps focus where it is when the parent re-renders with a new onClose", () => {
    const { rerender } = render(<ShellSettings open={true} vaultName="Notas" onClose={() => {}} />);
    const dark = screen.getByRole("button", { name: "Oscuro" });
    dark.focus();
    rerender(<ShellSettings open={true} vaultName="Notas" onClose={() => {}} />);
    expect(document.activeElement).toBe(dark);
  });

  it("labels each option group with its setting", () => {
    render(<ShellSettings open={true} vaultName="Notas" onClose={() => {}} />);
    expect(screen.getByRole("group", { name: "Tema" })).not.toBeNull();
    expect(screen.getByRole("group", { name: "Densidad" })).not.toBeNull();
  });
});
