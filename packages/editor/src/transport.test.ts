import { describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { createUpdateBatcher, type DocTransport } from "./transport";

/** One valid Yjs update carrying a unique key, so batches can be inspected after merging. */
const makeUpdate = (key: string): Uint8Array => {
  const doc = new Y.Doc();
  doc.getMap("meta").set(key, true);
  return Y.encodeStateAsUpdate(doc);
};

const transportRecording = (applied: Uint8Array[]): DocTransport => ({
  load: async () => new Uint8Array(),
  apply: async (update) => {
    applied.push(update);
  },
});

const keysOf = (update: Uint8Array): string[] => {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, update);
  return [...doc.getMap("meta").keys()];
};

describe("createUpdateBatcher", () => {
  it("coalesces pushes into a single merged apply after the delay", async () => {
    vi.useFakeTimers();
    const applied: Uint8Array[] = [];
    const batcher = createUpdateBatcher(transportRecording(applied), { delayMs: 250 });
    batcher.push(makeUpdate("alpha"));
    batcher.push(makeUpdate("beta"));
    expect(applied).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(250);
    expect(applied).toHaveLength(1);
    expect(keysOf(applied[0] as Uint8Array).sort()).toEqual(["alpha", "beta"]);
    vi.useRealTimers();
  });

  it("flush sends pending updates without waiting for the delay", async () => {
    const applied: Uint8Array[] = [];
    const batcher = createUpdateBatcher(transportRecording(applied), { delayMs: 250 });
    batcher.push(makeUpdate("alpha"));
    batcher.flush();
    await Promise.resolve();
    expect(applied).toHaveLength(1);
  });

  it("reports apply failures through onError and keeps sending subsequent batches", async () => {
    vi.useFakeTimers();
    const onError = vi.fn();
    const applied: Uint8Array[] = [];
    let attempt = 0;
    const transport: DocTransport = {
      load: async () => new Uint8Array(),
      apply: async (update) => {
        attempt += 1;
        if (attempt === 1) throw new Error("storage down");
        applied.push(update);
      },
    };
    const batcher = createUpdateBatcher(transport, { delayMs: 250, onError });
    batcher.push(makeUpdate("first"));
    await vi.advanceTimersByTimeAsync(250);
    expect(onError).toHaveBeenCalledOnce();
    expect(applied).toHaveLength(0);

    batcher.push(makeUpdate("second"));
    batcher.flush();
    await vi.runAllTimersAsync();
    expect(applied).toHaveLength(1);
    expect(keysOf(applied[0] as Uint8Array)).toEqual(["second"]);
    vi.useRealTimers();
  });
});
