import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import i18next from "./i18n";

/** Shell preferences (#31): theme, density and language, persisted in localStorage. */
export type ThemeMode = "system" | "light" | "dark";
export type DensityMode = "comfortable" | "compact";
export type LanguageCode = "es-MX" | "en";

export interface ShellPreferences {
  theme: ThemeMode;
  density: DensityMode;
  language: LanguageCode;
}

const THEME_KEY = "fossil.theme";
const DENSITY_KEY = "fossil.density";
const LANGUAGE_KEY = "fossil.language";

// Storage can be unavailable (private mode, quota, policies): preferences then
// live only for the session instead of crashing the shell.
function readPref(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writePref(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Not persisted; the change still applies to this session.
  }
}

/**
 * Windows paints Mica and the title bar from the window theme, not from the
 * page: pin it too, or "dark" with a light Windows leaves light text on light
 * Mica (#116). `null` follows the system again.
 */
function syncWindowTheme(theme: ThemeMode): void {
  if (!isTauri()) return;
  getCurrentWindow()
    .setTheme(theme === "system" ? null : theme)
    .catch(() => {
      // Cosmetic: the page theme already applied.
    });
}

export function applyTheme(theme: ThemeMode): void {
  if (theme === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  syncWindowTheme(theme);
  writePref(THEME_KEY, theme);
}

export function applyDensity(density: DensityMode): void {
  document.documentElement.dataset.density = density;
  writePref(DENSITY_KEY, density);
}

export function applyLanguage(language: LanguageCode): void {
  document.documentElement.lang = language;
  writePref(LANGUAGE_KEY, language);
  void i18next.changeLanguage(language);
}

/** Saved preferences, validated; never touches the document. */
export function readShellPreferences(): ShellPreferences {
  const rawTheme = readPref(THEME_KEY);
  const rawLang = readPref(LANGUAGE_KEY);
  return {
    theme: rawTheme === "light" || rawTheme === "dark" ? rawTheme : "system",
    density: readPref(DENSITY_KEY) === "compact" ? "compact" : "comfortable",
    language: rawLang === "en" ? "en" : "es-MX",
  };
}

/** Applies the saved preferences once, before the first render (main.tsx), so there is no flash. */
export function applyStoredShellPreferences(): ShellPreferences {
  const prefs = readShellPreferences();
  applyTheme(prefs.theme);
  applyDensity(prefs.density);
  if (readPref(LANGUAGE_KEY) !== null) applyLanguage(prefs.language);
  return prefs;
}
