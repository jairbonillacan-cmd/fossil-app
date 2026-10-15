import { EDITOR_MESSAGES_EN, EDITOR_MESSAGES_ES_MX } from "@fossil/editor";
import { describe, expect, it } from "vitest";
import en from "./en.json";
import esMx from "./es-MX.json";
import i18next from "./index";

function keyPaths(value: Record<string, unknown>, prefix = ""): string[] {
  return Object.entries(value).flatMap(([key, child]) => {
    const path = prefix === "" ? key : `${prefix}.${key}`;
    if (typeof child === "object" && child !== null) {
      return keyPaths(child as Record<string, unknown>, path);
    }
    return [path];
  });
}

describe("i18n", () => {
  it("es-MX and en define exactly the same keys", () => {
    expect(new Set(keyPaths(en))).toEqual(new Set(keyPaths(esMx)));
  });

  it("covers every editor.* key the block editor asks for", () => {
    const flat = (catalog: Record<string, unknown>) =>
      Object.fromEntries(keyPaths(catalog).map((path) => [path, i18next.t(path)]));
    i18next.changeLanguage("en");
    const english = flat(en);
    i18next.changeLanguage("es-MX");
    const spanish = flat(esMx);
    for (const [key, text] of Object.entries(EDITOR_MESSAGES_ES_MX))
      expect(spanish[key]).toBe(text);
    for (const [key, text] of Object.entries(EDITOR_MESSAGES_EN)) expect(english[key]).toBe(text);
  });

  it("initializes with es-MX as the default language", () => {
    expect(i18next.language).toBe("es-MX");
    expect(i18next.t("app.loading")).toBe("Cargando…");
  });

  it("interpolates version and data dir in both languages", () => {
    const values = { version: "0.0.1", dataDir: "C:\\Data" };
    expect(i18next.t("app.info", values)).toBe("Versión 0.0.1 · Datos: C:\\Data");
    i18next.changeLanguage("en");
    expect(i18next.t("app.info", values)).toBe("Version 0.0.1 · Data: C:\\Data");
    i18next.changeLanguage("es-MX");
  });
});
