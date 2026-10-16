const SCROLL_IDLE_MS = 700;

/**
 * Tracks scroll activity across the app: while an element scrolls, a
 * `data-scrolling` attribute is set on it and cleared shortly after it stops,
 * so the global scrollbar styles accent the thumb without hovering it
 * (spec R1.5 r1-scrollbar). The cost per event is O(1): one attribute toggle
 * plus one timer per scrolling element. Reduced motion still gets no
 * transition — the CSS media query in styles.css handles that.
 *
 * The listener runs in the capture phase because scroll events do not bubble.
 */
export function startScrollActivityTracking(
  target: Document = document,
  idleMs: number = SCROLL_IDLE_MS,
): () => void {
  const timers = new WeakMap<Element, number>();
  const scrollingElementOf = (eventTarget: EventTarget | null): Element | null => {
    if (eventTarget instanceof Document) return eventTarget.documentElement;
    if (eventTarget instanceof Element) return eventTarget;
    return null;
  };
  const onScroll = (event: Event) => {
    const el = scrollingElementOf(event.target);
    if (el === null) return;
    el.setAttribute("data-scrolling", "");
    const previous = timers.get(el);
    if (previous !== undefined) window.clearTimeout(previous);
    timers.set(
      el,
      window.setTimeout(() => el.removeAttribute("data-scrolling"), idleMs),
    );
  };
  target.addEventListener("scroll", onScroll, { capture: true, passive: true });
  return () => {
    target.removeEventListener("scroll", onScroll, { capture: true });
  };
}
