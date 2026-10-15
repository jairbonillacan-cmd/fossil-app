import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppInfoPanel } from "./app-info";
import { commands } from "./bindings";
import "./i18n";

vi.mock("./bindings", () => ({
  commands: {
    appInfo: vi.fn(),
  },
}));

beforeEach(() => {
  vi.mocked(commands.appInfo).mockReset();
});

describe("AppInfoPanel", () => {
  it("renders version and data dir on success", async () => {
    vi.mocked(commands.appInfo).mockResolvedValue({
      status: "ok",
      data: { version: "0.2.0", data_dir: "D:/Boveda" },
    });
    render(<AppInfoPanel />);
    expect(await screen.findByText(/Versión 0\.2\.0/)).not.toBeNull();
    expect(screen.getByText(/D:\/Boveda/)).not.toBeNull();
  });

  it("renders the error message on failure", async () => {
    vi.mocked(commands.appInfo).mockResolvedValue({
      status: "error",
      error: "DataDirUnavailable",
    });
    render(<AppInfoPanel />);
    expect(await screen.findByText(/DataDirUnavailable/)).not.toBeNull();
  });
});
