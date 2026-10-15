import { open } from "@tauri-apps/plugin-dialog";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VaultInfo } from "./bindings";
import { commands } from "./bindings";
import { VaultScreen, vaultNameFromPath } from "./vault-screen";
import "./i18n";

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("./bindings", () => ({
  commands: { vaultRecent: vi.fn(), vaultCreate: vi.fn(), vaultOpen: vi.fn() },
}));

const acme: VaultInfo = { name: "Acme", path: "C:\\Data\\Acme" };

afterEach(cleanup);

beforeEach(() => {
  vi.mocked(open).mockReset();
  vi.mocked(commands.vaultRecent).mockReset();
  vi.mocked(commands.vaultCreate).mockReset();
  vi.mocked(commands.vaultOpen).mockReset();
});

describe("vaultNameFromPath", () => {
  it("takes the folder name regardless of separator", () => {
    expect(vaultNameFromPath("C:\\Data\\Acme")).toBe("Acme");
    expect(vaultNameFromPath("/home/user/acme/")).toBe("acme");
    expect(vaultNameFromPath("Acme")).toBe("Acme");
  });
});

describe("VaultScreen", () => {
  it("renders the two actions and the empty recents state", async () => {
    vi.mocked(commands.vaultRecent).mockResolvedValue({ status: "ok", data: [] });
    render(<VaultScreen onVaultOpen={vi.fn()} />);
    expect(screen.getByRole("heading", { level: 1, name: "Fossil" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Crear bóveda" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Abrir bóveda" })).not.toBeNull();
    expect(await screen.findByText("Todavía no hay bóvedas recientes.")).not.toBeNull();
  });

  it("falls back to the empty state when recents fail to load", async () => {
    vi.mocked(commands.vaultRecent).mockResolvedValue({ status: "error", error: "NotImplemented" });
    render(<VaultScreen onVaultOpen={vi.fn()} />);
    expect(await screen.findByText("Todavía no hay bóvedas recientes.")).not.toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("reports notImplemented when creating a vault is unavailable", async () => {
    vi.mocked(commands.vaultRecent).mockResolvedValue({ status: "ok", data: [] });
    vi.mocked(open).mockResolvedValue("C:\\Data\\Acme");
    vi.mocked(commands.vaultCreate).mockResolvedValue({ status: "error", error: "NotImplemented" });
    render(<VaultScreen onVaultOpen={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Crear bóveda" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("Esta función todavía no está disponible.");
    expect(commands.vaultCreate).toHaveBeenCalledWith("C:\\Data\\Acme", "Acme");
  });

  it("extracts the message from a Storage error without showing raw JSON", async () => {
    vi.mocked(commands.vaultRecent).mockResolvedValue({ status: "ok", data: [] });
    vi.mocked(open).mockResolvedValue("C:\\Data\\Acme");
    vi.mocked(commands.vaultCreate).mockResolvedValue({
      status: "error",
      error: { Storage: "Permiso denegado" },
    });
    render(<VaultScreen onVaultOpen={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Crear bóveda" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("Algo salió mal: Permiso denegado");
  });

  it("opens a recent vault and reports it to the app", async () => {
    vi.mocked(commands.vaultRecent).mockResolvedValue({ status: "ok", data: [acme] });
    vi.mocked(commands.vaultOpen).mockResolvedValue({ status: "ok", data: acme });
    const onVaultOpen = vi.fn();
    render(<VaultScreen onVaultOpen={onVaultOpen} />);
    fireEvent.click(await screen.findByRole("button", { name: /Acme/ }));
    await vi.waitFor(() => expect(onVaultOpen).toHaveBeenCalledWith(acme));
  });

  it("does nothing when the folder picker is cancelled", async () => {
    vi.mocked(commands.vaultRecent).mockResolvedValue({ status: "ok", data: [] });
    vi.mocked(open).mockResolvedValue(null);
    render(<VaultScreen onVaultOpen={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Abrir bóveda" }));
    expect(commands.vaultOpen).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
