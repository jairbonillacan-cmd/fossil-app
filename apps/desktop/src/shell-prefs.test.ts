/// <reference types="vite/client" />
import { afterEach, describe, expect, it, vi } from "vitest";
import indexHtml from "../index.html?raw";
import tauriConf from "../src-tauri/tauri.conf.json";

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

  it("keeps a transparent initial background in tauri.conf.json and index.html (#130)", () => {
    const mainWindow = tauriConf.app.windows.find((w) => w.label === "main");
    expect(mainWindow).toBeDefined();
    expect(mainWindow?.transparent).toBe(true);
    expect(mainWindow?.backgroundColor).toEqual([0, 0, 0, 0]);
    expect(indexHtml).toContain("background: transparent;");
    expect(indexHtml).toContain("color-scheme: light dark;");
    expect(indexHtml).toContain('localStorage.getItem("fossil.theme")');
  });

  it("falls back to defaults when stored values are corrupt JSON or wrong types", () => {
    localStorage.setItem("fossil.theme", '{"theme":"dark"}');
    localStorage.setItem("fossil.density", "[1,2]");
    localStorage.setItem("fossil.language", '{"lang":"en"}');
    expect(readShellPreferences()).toEqual({
      theme: "system",
      density: "comfortable",
      language: "es-MX",
    });
    localStorage.setItem("fossil.theme", "undefined");
    localStorage.setItem("fossil.density", "true");
    localStorage.setItem("fossil.language", "42");
    expect(readShellPreferences()).toEqual({
      theme: "system",
      density: "comfortable",
      language: "es-MX",
    });
  });

  it("falls back to defaults when only legacy keys or an old locale exist", () => {
    // Preferences from an older version: different key names and "es-ES".
    localStorage.setItem("fossil.appearance", "dark");
    localStorage.setItem("fossil.uiDensity", "compact");
    localStorage.setItem("fossil.language", "es-ES");
    const prefs = applyStoredShellPreferences();
    expect(prefs).toEqual({ theme: "system", density: "comfortable", language: "es-MX" });
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(document.documentElement.dataset.density).toBe("comfortable");
  });
});
