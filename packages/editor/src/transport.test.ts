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

/** A large Yjs update (about `sizeBytes` of real content), as a hostile-but-valid payload. */
const bigUpdate = (sizeBytes: number): Uint8Array => {
  const doc = new Y.Doc();
  doc.getText("bulk").insert(0, "x".repeat(sizeBytes));
  return Y.encodeStateAsUpdate(doc);
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

  it("reports apply failures through onError, retains failed updates, and merges them on next flush", async () => {
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
    await batcher.flush();
    expect(applied).toHaveLength(1);
    expect(keysOf(applied[0] as Uint8Array).sort()).toEqual(["first", "second"]);
    batcher.dispose();
    vi.useRealTimers();
  });

  it("does not retry a failed apply: each merged batch reaches apply exactly once", async () => {
    vi.useFakeTimers();
    const onError = vi.fn();
    const attempts: Uint8Array[] = [];
    const transport: DocTransport = {
      load: async () => new Uint8Array(),
      apply: async (update) => {
        attempts.push(update);
        throw new Error("storage down");
      },
    };
    const batcher = createUpdateBatcher(transport, { delayMs: 250, onError });
    batcher.push(makeUpdate("alpha"));
    batcher.push(makeUpdate("beta"));
    await vi.runAllTimersAsync();
    await vi.runAllTimersAsync();
    expect(attempts).toHaveLength(1);
    expect(keysOf(attempts[0] as Uint8Array).sort()).toEqual(["alpha", "beta"]);
    expect(onError).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });

  it("sends nothing before the window elapses and anchors one window per batch", async () => {
    vi.useFakeTimers();
    const applied: Uint8Array[] = [];
    const batcher = createUpdateBatcher(transportRecording(applied), { delayMs: 100 });
    batcher.push(makeUpdate("alpha"));
    await vi.advanceTimersByTimeAsync(99);
    expect(applied).toHaveLength(0);
    // A push inside the open window joins it (the timer stays anchored to the first push).
    batcher.push(makeUpdate("beta"));
    await vi.advanceTimersByTimeAsync(1);
    expect(applied).toHaveLength(1);
    expect(keysOf(applied[0] as Uint8Array).sort()).toEqual(["alpha", "beta"]);
    // The next push opens a fresh window.
    batcher.push(makeUpdate("gamma"));
    await vi.advanceTimersByTimeAsync(99);
    expect(applied).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(applied).toHaveLength(2);
    expect(keysOf(applied[1] as Uint8Array)).toEqual(["gamma"]);
    vi.useRealTimers();
  });

  it("cancels the pending timer on flush so a batch is never sent twice", async () => {
    vi.useFakeTimers();
    const applied: Uint8Array[] = [];
    const batcher = createUpdateBatcher(transportRecording(applied), { delayMs: 250 });
    batcher.push(makeUpdate("alpha"));
    batcher.flush();
    await vi.runAllTimersAsync();
    expect(applied).toHaveLength(1);
    // A later push arms a new full window.
    batcher.push(makeUpdate("beta"));
    await vi.advanceTimersByTimeAsync(249);
    expect(applied).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(applied).toHaveLength(2);
    vi.useRealTimers();
  });

  it("preserves delivery order when one apply is slow (chained promises)", async () => {
    vi.useFakeTimers();
    const applied: Uint8Array[] = [];
    const gates: Array<() => void> = [];
    const transport: DocTransport = {
      load: async () => new Uint8Array(),
      apply: (update) =>
        new Promise<void>((resolve) => {
          applied.push(update);
          gates.push(() => resolve());
        }),
    };
    const batcher = createUpdateBatcher(transport, { delayMs: 100 });
    batcher.push(makeUpdate("alpha"));
    await vi.advanceTimersByTimeAsync(100); // first batch in flight, unresolved
    batcher.push(makeUpdate("beta"));
    await vi.advanceTimersByTimeAsync(100); // second batch queued behind the chain
    expect(applied.map((update) => keysOf(update))).toEqual([["alpha"]]);

    (gates[0] as () => void)();
    await vi.runAllTimersAsync();
    expect(applied.map((update) => keysOf(update))).toEqual([["alpha"], ["beta"]]);
    vi.useRealTimers();
  });

  it("merges and delivers a 1 MB update without dropping its content", async () => {
    vi.useFakeTimers();
    const applied: Uint8Array[] = [];
    const batcher = createUpdateBatcher(transportRecording(applied), { delayMs: 250 });
    const size = 1024 * 1024;
    const big = bigUpdate(size);
    expect(big.length).toBeGreaterThanOrEqual(size);
    batcher.push(big);
    batcher.push(makeUpdate("small"));
    await vi.advanceTimersByTimeAsync(250);
    expect(applied).toHaveLength(1);
    const roundtrip = new Y.Doc();
    Y.applyUpdate(roundtrip, applied[0] as Uint8Array);
    expect(roundtrip.getText("bulk").toString()).toHaveLength(size);
    expect([...roundtrip.getMap("meta").keys()]).toEqual(["small"]);
    vi.useRealTimers();
  });

  it("survives hostile payloads alone in a batch: they reach apply undecodable", async () => {
    vi.useFakeTimers();
    const applied: Uint8Array[] = [];
    const batcher = createUpdateBatcher(transportRecording(applied), { delayMs: 250 });
    // `Y.mergeUpdates` decodes leniently, so garbage bytes (or a wrongly-typed
    // value, reachable only by violating the `Uint8Array` contract) do not crash
    // the send; the merged payload simply cannot be decoded when storage applies it.
    batcher.push(new Uint8Array([255, 254, 1, 2, 3, 200]));
    await vi.advanceTimersByTimeAsync(250);
    expect(applied).toHaveLength(1);
    expect(() => Y.applyUpdate(new Y.Doc(), applied[0] as Uint8Array)).toThrow();

    const typed = createUpdateBatcher(transportRecording(applied), { delayMs: 250 });
    typed.push("not-an-update" as unknown as Uint8Array);
    typed.flush();
    await Promise.resolve();
    expect(applied).toHaveLength(2);
    expect(() => Y.applyUpdate(new Y.Doc(), applied[1] as Uint8Array)).toThrow();

    // Valid updates pushed afterwards still flow through.
    batcher.push(makeUpdate("after"));
    batcher.flush();
    await vi.runAllTimersAsync();
    expect(applied).toHaveLength(3);
    expect(keysOf(applied[2] as Uint8Array)).toEqual(["after"]);
    vi.useRealTimers();
  });

  it("documents that garbage coalesced with a second update makes send throw", async () => {
    vi.useFakeTimers();
    // Y.mergeUpdates(garbage, anything) fails mid-merge, and the batcher does not
    // guard `send`: the error escapes the timer callback (and `flush`) synchronously.
    const timed = createUpdateBatcher(transportRecording([]), { delayMs: 250 });
    timed.push(new Uint8Array([255, 254, 1, 2, 3, 200]));
    timed.push(makeUpdate("valid"));
    expect(() => vi.advanceTimersByTime(250)).toThrow();

    const flushed = createUpdateBatcher(transportRecording([]), { delayMs: 250 });
    flushed.push(new Uint8Array([255, 254, 1, 2, 3, 200]));
    flushed.push(new Uint8Array());
    expect(() => flushed.flush()).toThrow();
    vi.useRealTimers();
  });

  it("sends an empty pushed update as an empty batch instead of crashing", async () => {
    const applied: Uint8Array[] = [];
    const batcher = createUpdateBatcher(transportRecording(applied), { delayMs: 250 });
    batcher.push(new Uint8Array());
    batcher.flush();
    await Promise.resolve();
    expect(applied).toHaveLength(1);
    expect((applied[0] as Uint8Array).length).toBe(0);
  });

  it("skips Y.mergeUpdates when flushing a single update and flushes on pagehide until disposed", async () => {
    const applied: Uint8Array[] = [];
    const batcher = createUpdateBatcher(transportRecording(applied), { delayMs: 5000 });
    const single = makeUpdate("solo");
    batcher.push(single);
    window.dispatchEvent(new Event("pagehide"));
    await batcher.flush();
    expect(applied).toHaveLength(1);
    expect(applied[0]).toBe(single);

    batcher.dispose();
    batcher.push(makeUpdate("after-dispose"));
    window.dispatchEvent(new Event("pagehide"));
    await Promise.resolve();
    expect(applied).toHaveLength(1);
  });
});
