// Demo tabs on the landing, following the WAI-ARIA tabs pattern:
// roving tabindex, ArrowLeft/ArrowRight (wrapping), Home and End, automatic activation.
// Each panel is made focusable here (tabindex="0") so keyboard users can scroll it.
//
// The panels ship empty (aria-busy). Their HTML lives in site/demo/*.html and is fetched as a
// separate chunk: the first one when the browser is idle after the page has loaded, the others
// the first time their tab is opened. That keeps the demo out of the critical path.

const fragments = {
  editor: () => import("./demo/editor.html?raw"),
  search: () => import("./demo/search.html?raw"),
  content: () => import("./demo/content.html?raw"),
  commerce: () => import("./demo/commerce.html?raw"),
};

async function load(panel) {
  if (!panel || panel.dataset.state) return;
  panel.dataset.state = "loading";
  try {
    const module = await fragments[panel.dataset.fragment]();
    panel.innerHTML = module.default;
    panel.dataset.state = "ready";
  } catch {
    panel.innerHTML =
      '<p class="demo-loading">No se pudo cargar la demostración. Mira lo que ya está disponible en el <a href="/changelog/">changelog</a>.</p>';
    panel.dataset.state = "error";
  }
  panel.removeAttribute("aria-busy");
}

const tablist = document.querySelector("[data-tabs]");

if (tablist) {
  const tabs = [...tablist.querySelectorAll('[role="tab"]')];
  const panels = tabs.map((tab) => document.getElementById(tab.dataset.pane));
  for (const panel of panels) if (panel) panel.tabIndex = 0;

  const select = (index, { focus = false } = {}) => {
    tabs.forEach((tab, i) => {
      const active = i === index;
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-selected", String(active));
      tab.tabIndex = active ? 0 : -1;
      if (panels[i]) {
        panels[i].classList.toggle("is-active", active);
        panels[i].hidden = !active;
      }
    });
    load(panels[index]);
    if (focus) tabs[index].focus();
  };

  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => select(index));
  });

  tablist.addEventListener("keydown", (event) => {
    const current = tabs.indexOf(document.activeElement);
    if (current === -1) return;
    const last = tabs.length - 1;
    const next = {
      ArrowRight: current === last ? 0 : current + 1,
      ArrowLeft: current === 0 ? last : current - 1,
      Home: 0,
      End: last,
    }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    select(next, { focus: true });
  });

  const whenIdle = window.requestIdleCallback ?? ((run) => setTimeout(run, 200));
  const start = () => whenIdle(() => load(panels[0]));
  if (document.readyState === "complete") start();
  else window.addEventListener("load", start, { once: true });
}
