import { describe, expect, it } from "vitest";
import * as Y from "yjs";

/** Deterministic PRNG (mulberry32) so shuffled application orders are reproducible. */
const mulberry32 = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/** Fisher-Yates shuffle driven by the seeded PRNG (no Math.random, no flakiness). */
const shuffled = <T>(items: T[], random: () => number): T[] => {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const left = copy[i] as T;
    copy[i] = copy[j] as T;
    copy[j] = left;
  }
  return copy;
};

/** Appends one neutral block, shaped as the editor writes it (paragraph + blockId + text). */
const appendBlock = (fragment: Y.XmlFragment, id: string, text: string): void => {
  const paragraph = new Y.XmlElement("paragraph");
  paragraph.setAttribute("blockId", id);
  const content = new Y.XmlText();
  content.insert(0, text);
  paragraph.insert(0, [content]);
  fragment.insert(fragment.length, [paragraph]);
};

/** Live diff updates of sequential edits, as captured by `doc.on("update")` in transport.ts. */
const liveUpdatesOf = (edits: number): { doc: Y.Doc; updates: Uint8Array[] } => {
  const doc = new Y.Doc();
  const updates: Uint8Array[] = [];
  doc.on("update", (update: Uint8Array) => {
    updates.push(update);
  });
  const fragment = doc.getXmlFragment("body");
  for (let i = 0; i < edits; i += 1) {
    appendBlock(fragment, `blk_${i}`, `Plan Q4 block ${i}`);
    if (i % 2 === 0) {
      (fragment.get(i) as Y.XmlElement).setAttribute("blockId", `blk_renamed_${i}`);
    }
  }
  return { doc, updates };
};

const bodySnapshot = (doc: Y.Doc): string => doc.getXmlFragment("body").toString();

describe("Yjs XmlFragment synchronization", () => {
  it("converges when live updates are applied out of order, duplicated and delayed (seeded)", () => {
    const random = mulberry32(0x2a);
    for (const trial of [1, 2, 3]) {
      const { doc: source, updates } = liveUpdatesOf(8);
      const target = new Y.Doc();
      // "Delayed" delivery: seeded shuffle of the live diffs, each one duplicated.
      for (const update of shuffled(updates, random)) {
        Y.applyUpdate(target, update);
        Y.applyUpdate(target, update);
      }
      expect(bodySnapshot(target), `trial ${trial}`).toBe(bodySnapshot(source));
    }
  });

  it("converges when the shuffled diffs are merged into one blob and applied once", () => {
    const { doc: source, updates } = liveUpdatesOf(8);
    const merged = Y.mergeUpdates(shuffled(updates, mulberry32(0x42)));
    const target = new Y.Doc();
    Y.applyUpdate(target, merged);
    expect(bodySnapshot(target)).toBe(bodySnapshot(source));
  });

  it("converges between two concurrent editors regardless of who exchanges state first", () => {
    // Fixed client IDs keep the merged block order deterministic across runs.
    const left = new Y.Doc();
    left.clientID = 1;
    const right = new Y.Doc();
    right.clientID = 2;
    for (const [doc, prefix] of [
      [left, "left"],
      [right, "right"],
    ] as const) {
      appendBlock(doc.getXmlFragment("body"), `${prefix}_blk`, `${prefix} wrote first`);
    }

    const rightState = Y.encodeStateAsUpdate(right);
    const leftState = Y.encodeStateAsUpdate(left);
    // Right sees left's state first...
    Y.applyUpdate(right, leftState);
    Y.applyUpdate(left, rightState);
    expect(bodySnapshot(left)).toBe(bodySnapshot(right));

    // ...and the mirrored order reaches the same document.
    const lateLeft = new Y.Doc();
    lateLeft.clientID = 1;
    const lateRight = new Y.Doc();
    lateRight.clientID = 2;
    appendBlock(lateLeft.getXmlFragment("body"), "left_blk", "left wrote first");
    appendBlock(lateRight.getXmlFragment("body"), "right_blk", "right wrote first");
    Y.applyUpdate(lateLeft, Y.encodeStateAsUpdate(lateRight));
    Y.applyUpdate(lateRight, Y.encodeStateAsUpdate(lateLeft));
    expect(bodySnapshot(lateLeft)).toBe(bodySnapshot(lateRight));
    expect(bodySnapshot(lateLeft)).toBe(bodySnapshot(left));
  });

  it("throws on malformed updates without killing the doc or corrupting prior content", () => {
    const target = new Y.Doc();
    appendBlock(target.getXmlFragment("body"), "blk_survivor", "Acme survivor block");
    const before = bodySnapshot(target);

    expect(() => Y.applyUpdate(target, new Uint8Array([255, 254, 1, 2, 3, 200]))).toThrow();
    expect(bodySnapshot(target)).toBe(before);

    const source = new Y.Doc();
    appendBlock(source.getXmlFragment("body"), "blk_new", "Plan Q4 new block");
    const full = Y.encodeStateAsUpdate(source);
    expect(() => Y.applyUpdate(target, full.slice(0, Math.floor(full.length / 2)))).toThrow();
    // A truncated update never lands halfway: the doc keeps its previous content.
    expect(bodySnapshot(target)).toBe(before);

    // The doc is still usable: a fresh valid update applies and merges cleanly.
    Y.applyUpdate(target, full);
    expect(bodySnapshot(target)).toContain("Plan Q4 new block");
    expect(bodySnapshot(target)).toContain("Acme survivor block");
  });
});
