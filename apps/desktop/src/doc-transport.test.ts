import { beforeEach, describe, expect, it, vi } from "vitest";
import { commands } from "./bindings";
import { createObjectTransport, DocTransportError } from "./doc-transport";

vi.mock("./bindings", () => ({
  commands: {
    objectLoadDoc: vi.fn(),
    objectApplyUpdate: vi.fn(),
  },
}));

const loadDoc = vi.mocked(commands.objectLoadDoc);
const applyUpdate = vi.mocked(commands.objectApplyUpdate);

describe("createObjectTransport", () => {
  beforeEach(() => {
    loadDoc.mockReset();
    applyUpdate.mockReset();
  });

  it("loads the object's Yjs state as bytes", async () => {
    loadDoc.mockResolvedValue({ status: "ok", data: [1, 2, 3] });
    const bytes = await createObjectTransport("obj-1").load();
    expect(loadDoc).toHaveBeenCalledWith("obj-1");
    expect(bytes).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("sends each batched update to object_apply_update", async () => {
    applyUpdate.mockResolvedValue({ status: "ok", data: null });
    await createObjectTransport("obj-1").apply(new Uint8Array([9, 8]));
    expect(applyUpdate).toHaveBeenCalledWith("obj-1", [9, 8]);
  });

  it("surfaces vault errors as DocTransportError", async () => {
    loadDoc.mockResolvedValue({ status: "error", error: "VaultNotOpen" });
    await expect(createObjectTransport("obj-1").load()).rejects.toBeInstanceOf(DocTransportError);
    applyUpdate.mockResolvedValue({ status: "error", error: { Storage: "disk full" } });
    await expect(createObjectTransport("obj-1").apply(new Uint8Array([1]))).rejects.toThrow(
      "disk full",
    );
  });
});
