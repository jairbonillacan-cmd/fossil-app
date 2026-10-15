import { beforeEach, describe, expect, it, vi } from "vitest";
import { commands } from "./bindings";
import { createObjectTransport, DocTransportError } from "./doc-transport";

vi.mock("./bindings", () => ({
  commands: {
    objectLoadDoc: vi.fn(),
    objectApplyUpdate: vi.fn(),
    attachmentSave: vi.fn(),
    attachmentLoad: vi.fn(),
  },
}));

const loadDoc = vi.mocked(commands.objectLoadDoc);
const applyUpdate = vi.mocked(commands.objectApplyUpdate);
const attachmentSave = vi.mocked(commands.attachmentSave);
const attachmentLoad = vi.mocked(commands.attachmentLoad);

describe("createObjectTransport", () => {
  beforeEach(() => {
    loadDoc.mockReset();
    applyUpdate.mockReset();
    attachmentSave.mockReset();
    attachmentLoad.mockReset();
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

  it("saves and loads image attachments through attachment_save and attachment_load", async () => {
    const transport = createObjectTransport("obj-1");
    attachmentSave.mockResolvedValue({ status: "ok", data: "attachments/01J8.png" });
    expect(await transport.saveAttachment?.("a.png", new Uint8Array([1, 2]))).toBe(
      "attachments/01J8.png",
    );
    expect(attachmentSave).toHaveBeenCalledWith("a.png", [1, 2]);
    attachmentLoad.mockResolvedValue({ status: "ok", data: [1, 2] });
    expect(await transport.loadAttachment?.("attachments/01J8.png")).toEqual(
      new Uint8Array([1, 2]),
    );
  });

  it("surfaces vault errors as DocTransportError", async () => {
    loadDoc.mockResolvedValue({ status: "error", error: "VaultNotOpen" });
    await expect(createObjectTransport("obj-1").load()).rejects.toBeInstanceOf(DocTransportError);
    applyUpdate.mockResolvedValue({ status: "error", error: { Storage: "disk full" } });
    await expect(createObjectTransport("obj-1").apply(new Uint8Array([1]))).rejects.toThrow(
      "disk full",
    );
    attachmentSave.mockResolvedValue({ status: "error", error: { Storage: "too large" } });
    await expect(
      createObjectTransport("obj-1").saveAttachment?.("b.png", new Uint8Array([1])),
    ).rejects.toThrow("too large");
  });
});
