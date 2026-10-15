import { open } from "@tauri-apps/plugin-dialog";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./app";
import { commands, events } from "./bindings";
import "./i18n";

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
// The real editor is covered in page-body.test.tsx.
vi.mock("./page-body", () => ({
  PageBody: ({ objectId }: { objectId: string }) => <div data-testid="page-body">{objectId}</div>,
}));

vi.mock("./bindings", () => ({
  commands: {
    appInfo: vi.fn(),
    vaultCreate: vi.fn(),
    vaultRecent: vi.fn(),
    objectList: vi.fn(),
    objectCreate: vi.fn(),
    journalToday: vi.fn(),
  },
  events: {
    objectChanged: { listen: vi.fn() },
    indexUpdated: { listen: vi.fn() },
  },
}));

afterEach(cleanup);

beforeEach(() => {
  vi.mocked(open).mockReset();
  vi.mocked(commands.appInfo).mockReset();
  vi.mocked(commands.appInfo).mockResolvedValue({
    status: "ok",
    data: { version: "0.0.1", data_dir: "C:\\Data" },
  });
  vi.mocked(commands.vaultCreate).mockReset();
  vi.mocked(commands.vaultRecent).mockReset();
  vi.mocked(commands.vaultRecent).mockResolvedValue({ status: "ok", data: [] });
  vi.mocked(commands.objectList).mockResolvedValue({ status: "ok", data: [] });
  vi.mocked(events.objectChanged.listen).mockResolvedValue(() => {});
  vi.mocked(events.indexUpdated.listen).mockResolvedValue(() => {});
});

describe("App", () => {
  it("boots into the vault screen with the provisional wordmark", () => {
    render(<App />);
    expect(screen.getByRole("heading", { level: 1, name: "Fossil" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Crear bóveda" })).not.toBeNull();
  });

  it("shows the workspace with sidebar and editor after creating a vault", async () => {
    vi.mocked(open).mockResolvedValue("C:\\Data\\Acme");
    vi.mocked(commands.vaultCreate).mockResolvedValue({
      status: "ok",
      data: { name: "Acme", path: "C:\\Data\\Acme" },
    });
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Crear bóveda" }));
    expect(await screen.findByText("Acme")).not.toBeNull();
    expect(screen.getByText("Nueva página")).not.toBeNull();
    expect(screen.getByText("Hoy")).not.toBeNull();
    expect(screen.getByText("Ninguna página abierta")).not.toBeNull();
    // Version and data dir live in Settings (#31), not in the workspace.
    fireEvent.click(screen.getByRole("button", { name: "Ajustes" }));
    expect(await screen.findByText(/Versión 0\.0\.1/)).not.toBeNull();
  });
});
