import { afterEach, describe, expect, it, vi } from "vitest";

const setTheme = vi.fn(() => Promise.resolve());
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ setTheme }) }));

import i18next from "./i18n";
import {
  applyDensity,
  applyLanguage,
  applyStoredShellPreferences,
  applyTheme,
  readShellPreferences,
} from "./shell-prefs";

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  delete document.documentElement.dataset.theme;
  delete document.documentElement.dataset.density;
  void i18next.changeLanguage("es-MX");
});

describe("shell preferences (#31)", () => {
  it("applies and persists theme, density and language", async () => {
    applyTheme("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem("fossil.theme")).toBe("dark");
    applyTheme("system");
    expect(document.documentElement.dataset.theme).toBeUndefined();
    applyDensity("compact");
    expect(document.documentElement.dataset.density).toBe("compact");
    applyLanguage("en");
    expect(document.documentElement.lang).toBe("en");
    expect(localStorage.getItem("fossil.language")).toBe("en");
    await vi.waitFor(() => expect(i18next.language).toBe("en"));
  });

  it("pins the native window theme too, and releases it for system", () => {
    applyTheme("dark");
    expect(setTheme).toHaveBeenLastCalledWith("dark");
    applyTheme("system");
    expect(setTheme).toHaveBeenLastCalledWith(null);
  });

  it("applies saved values once and ignores invalid ones", () => {
    localStorage.setItem("fossil.theme", "dark");
    localStorage.setItem("fossil.density", "huge");
    const prefs = applyStoredShellPreferences();
    expect(prefs).toEqual({ theme: "dark", density: "comfortable", language: "es-MX" });
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.dataset.density).toBe("comfortable");
  });

  it("falls back to defaults and keeps working when storage is unavailable", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readShellPreferences()).toEqual({
      theme: "system",
      density: "comfortable",
      language: "es-MX",
    });
    applyTheme("light");
    expect(document.documentElement.dataset.theme).toBe("light");
  });
});
