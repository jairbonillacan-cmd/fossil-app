import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app";
import "./i18n";
import "@fossil/editor/styles.css";
import "./styles.css";
import { applyStoredShellPreferences } from "./shell-prefs";

// Theme, density and language before the first paint: no flash of defaults (#31).
applyStoredShellPreferences();

const container = document.getElementById("root");
if (container === null) {
  throw new Error("#root element missing in index.html");
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
