import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./en.json";
import esMx from "./es-MX.json";

export const DEFAULT_LANGUAGE = "es-MX";

void i18next.use(initReactI18next).init({
  lng: DEFAULT_LANGUAGE,
  fallbackLng: DEFAULT_LANGUAGE,
  resources: {
    "es-MX": { translation: esMx },
    en: { translation: en },
  },
  // React already escapes rendered strings.
  interpolation: { escapeValue: false },
});

export default i18next;
