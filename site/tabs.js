// Screenshot tabs on the landing, following the WAI-ARIA tabs pattern:
// roving tabindex, ArrowLeft/ArrowRight (wrapping), Home and End, automatic activation.
// Each panel is made focusable here (tabindex="0") so keyboard users can scroll it sideways
// on small screens, where the captures are wider than the viewport.

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
}
