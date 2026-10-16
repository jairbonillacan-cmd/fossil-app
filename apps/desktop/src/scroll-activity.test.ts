import { afterEach, describe, expect, it, vi } from "vitest";
import { startScrollActivityTracking } from "./scroll-activity";

describe("scroll-activity", () => {
  afterEach(() => {
    vi.useRealTimers();
    document.body.replaceChildren();
  });

  it("marks a scrolling element and clears the mark once scrolling stops", () => {
    vi.useFakeTimers();
    const stop = startScrollActivityTracking(document, 700);
    const el = document.createElement("div");
    document.body.appendChild(el);

    el.dispatchEvent(new Event("scroll"));
    expect(el.hasAttribute("data-scrolling")).toBe(true);

    vi.advanceTimersByTime(700);
    expect(el.hasAttribute("data-scrolling")).toBe(false);
    stop();
  });

  it("restarts the timer on every scroll event", () => {
    vi.useFakeTimers();
    const stop = startScrollActivityTracking(document, 700);
    const el = document.createElement("div");
    document.body.appendChild(el);

    el.dispatchEvent(new Event("scroll"));
    vi.advanceTimersByTime(400);
    el.dispatchEvent(new Event("scroll"));
    vi.advanceTimersByTime(400);
    expect(el.hasAttribute("data-scrolling")).toBe(true);

    vi.advanceTimersByTime(300);
    expect(el.hasAttribute("data-scrolling")).toBe(false);
    stop();
  });

  it("tracks elements independently and maps document scrolls to the root", () => {
    vi.useFakeTimers();
    const stop = startScrollActivityTracking(document, 700);
    const a = document.createElement("div");
    const b = document.createElement("div");
    document.body.append(a, b);

    a.dispatchEvent(new Event("scroll"));
    vi.advanceTimersByTime(400);
    b.dispatchEvent(new Event("scroll"));
    vi.advanceTimersByTime(400);
    expect(a.hasAttribute("data-scrolling")).toBe(false);
    expect(b.hasAttribute("data-scrolling")).toBe(true);

    document.dispatchEvent(new Event("scroll"));
    expect(document.documentElement.hasAttribute("data-scrolling")).toBe(true);
    stop();
  });
});
