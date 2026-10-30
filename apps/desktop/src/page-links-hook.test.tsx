import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ObjectMeta } from "./bindings";
import { commands, events } from "./bindings";
import { usePageLinks } from "./page-links";

vi.mock("./bindings", () => ({
  commands: { objectList: vi.fn(), objectGet: vi.fn(), objectCreate: vi.fn() },
  events: { objectChanged: { listen: vi.fn() } },
}));

afterEach(cleanup);

const page = (id: string, title: string): ObjectMeta =>
  ({ id, title, types: ["Page"], icon: null, parent: null, archived: false }) as ObjectMeta;

let emit: (id: string) => void = () => {};
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(commands.objectList).mockResolvedValue({
    status: "ok",
    data: [page("a", " Plan "), page("b", "plan")],
  });
  vi.mocked(events.objectChanged.listen).mockImplementation((cb) => {
    emit = (id) => cb({ event: "object:changed", id: 1, payload: { id } });
    return Promise.resolve(() => {});
  });
});

describe("usePageLinks (#137)", () => {
  it("re-reads only the changed page on body edits and the list when a title changes", async () => {
    const { result } = renderHook(() => usePageLinks("es-MX"));
    await waitFor(() => expect(result.current.onSearchObjects("")).toHaveLength(2));
    expect(commands.objectList).toHaveBeenCalledTimes(1);

    vi.mocked(commands.objectGet).mockResolvedValue({ status: "ok", data: page("a", " Plan ") });
    await act(async () => emit("a"));
    expect(commands.objectGet).toHaveBeenCalledWith("a");
    expect(commands.objectList).toHaveBeenCalledTimes(1);

    vi.mocked(commands.objectGet).mockResolvedValue({ status: "ok", data: page("a", "Plan 2") });
    await act(async () => emit("a"));
    expect(commands.objectList).toHaveBeenCalledTimes(2);
  });

  it("suggests trimmed titles so repeated ones are pinned by id", async () => {
    const { result } = renderHook(() => usePageLinks("es-MX"));
    await waitFor(() => expect(result.current.onSearchObjects("")).toHaveLength(2));
    expect(result.current.onSearchObjects("plan").map((x) => x.title)).toEqual(["Plan", "plan"]);
    expect(result.current.ambiguousTitles.has("plan")).toBe(true);
  });
});
