import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearRecents,
  listRecents,
  pushRecent,
  RECENT_LIMITS,
  resetRecentsCache,
} from "./shell-recents";

beforeEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  resetRecentsCache();
});

describe("shell-recents (#86)", () => {
  it("keeps most recent first, deduplicated and capped", () => {
    for (const id of ["a", "b", "c", "d", "e", "f"]) pushRecent("actions", id);
    pushRecent("actions", "c");
    expect(listRecents("actions")).toEqual(["c", "f", "e", "d", "b"]);
    expect(listRecents("actions")).toHaveLength(RECENT_LIMITS.actions);
    expect(listRecents("pages")).toEqual([]);
  });

  it("persists in localStorage and survives reload", () => {
    pushRecent("pages", "p1");
    pushRecent("pages", "p2");
    resetRecentsCache();
    expect(listRecents("pages")).toEqual(["p2", "p1"]);
    clearRecents("pages");
    resetRecentsCache();
    expect(listRecents("pages")).toEqual([]);
  });

  it("ignores corrupt storage and works when storage throws", () => {
    localStorage.setItem("fossil.recent.actions", "{not json");
    expect(listRecents("actions")).toEqual([]);
    localStorage.setItem("fossil.recent.actions", JSON.stringify(["ok", 3, ""]));
    expect(listRecents("actions")).toEqual(["ok"]);
    resetRecentsCache();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(pushRecent("actions", "z")).toEqual(["z", "ok"]);
    expect(listRecents("actions")).toEqual(["z", "ok"]);
  });
});
