import { describe, expect, it } from "vitest";
import * as Y from "yjs";

/**
 * Regression guard for large bodies (ADR-0015 budgets 5 000 blocks). The document
 * is built at the pure Yjs level (XmlFragment + paragraphs with a `blockId`
 * attribute) because mounting 5 000 nodes through headless TipTap is not viable;
 * serialization and reload are what this guards. No timing or performance asserts.
 */
const BLOCK_COUNT = 5000;

/** Neutral content per block, shaped as the editor writes it. */
const buildLargeDoc = (blocks: number): Y.Doc => {
  const doc = new Y.Doc();
  const fragment = doc.getXmlFragment("body");
  const created: Y.XmlElement[] = [];
  for (let i = 0; i < blocks; i += 1) {
    const paragraph = new Y.XmlElement("paragraph");
    paragraph.setAttribute("blockId", `blk_${i}`);
    const content = new Y.XmlText();
    content.insert(0, `Plan Q4 block ${i}`);
    paragraph.insert(0, [content]);
    created.push(paragraph);
  }
  fragment.insert(0, created);
  return doc;
};

const blockIdsOf = (doc: Y.Doc): string[] => {
  const ids: string[] = [];
  doc.getXmlFragment("body").forEach((child) => {
    if (child instanceof Y.XmlElement) ids.push(String(child.getAttribute("blockId")));
  });
  return ids;
};

describe("large document round-trip", () => {
  it(`serializes and reloads ${BLOCK_COUNT} blocks with ${BLOCK_COUNT} unique IDs`, () => {
    const source = buildLargeDoc(BLOCK_COUNT);

    const update = Y.encodeStateAsUpdate(source);
    expect(update.length).toBeGreaterThan(0);

    const reloaded = new Y.Doc();
    expect(() => Y.applyUpdate(reloaded, update)).not.toThrow();

    const fragment = reloaded.getXmlFragment("body");
    expect(fragment.length).toBe(BLOCK_COUNT);
    const ids = blockIdsOf(reloaded);
    expect(ids).toHaveLength(BLOCK_COUNT);
    expect(new Set(ids).size).toBe(BLOCK_COUNT);
    expect(ids[0]).toBe("blk_0");
    expect(ids[BLOCK_COUNT - 1]).toBe(`blk_${BLOCK_COUNT - 1}`);

    // Spot-check text content of the first and last reloaded blocks.
    const first = fragment.get(0) as Y.XmlElement;
    const last = fragment.get(fragment.length - 1) as Y.XmlElement;
    expect(first.toString()).toContain("Plan Q4 block 0");
    expect(last.toString()).toContain(`Plan Q4 block ${BLOCK_COUNT - 1}`);
  });
});
