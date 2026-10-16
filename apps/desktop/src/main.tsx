import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app";
import "./i18n";
import "@fossil/editor/styles.css";
import "./styles.css";
import { startScrollActivityTracking } from "./scroll-activity";
import { applyStoredShellPreferences } from "./shell-prefs";

// Theme, density and language before the first paint: no flash of defaults (#31).
applyStoredShellPreferences();
// Marks the scrolling element with data-scrolling so the global scrollbar
// styles accent the thumb while scrolling, not only on hover (#104).
startScrollActivityTracking();

const container = document.getElementById("root");
if (container === null) {
  throw new Error("#root element missing in index.html");
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
