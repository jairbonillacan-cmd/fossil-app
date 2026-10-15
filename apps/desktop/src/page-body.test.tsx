import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { commands } from "./bindings";
import "./i18n";
import { PageBody } from "./page-body";

vi.mock("./bindings", () => ({
  commands: {
    objectLoadDoc: vi.fn(),
    objectApplyUpdate: vi.fn(),
  },
}));

// TipTap + Yjs import cost is high on a busy machine.
const SLOW = 20_000;

describe("PageBody", () => {
  beforeEach(() => {
    vi.mocked(commands.objectLoadDoc).mockReset();
    vi.mocked(commands.objectApplyUpdate).mockReset();
  });
  afterEach(cleanup);

  it(
    "mounts the block editor once the body is loaded and writes nothing on open",
    async () => {
      // Empty Yjs document (lib0 v1): no structs, empty delete set.
      vi.mocked(commands.objectLoadDoc).mockResolvedValue({ status: "ok", data: [0, 0] });
      const { container } = render(<PageBody objectId="obj-1" />);
      await vi.waitFor(() => expect(container.querySelector(".fossil-editor")).not.toBeNull(), {
        timeout: SLOW,
      });
      expect(commands.objectLoadDoc).toHaveBeenCalledWith("obj-1");
      expect(commands.objectApplyUpdate).not.toHaveBeenCalled();
    },
    SLOW,
  );

  it(
    "shows a localized alert when the vault cannot load the body",
    async () => {
      vi.mocked(commands.objectLoadDoc).mockResolvedValue({
        status: "error",
        error: "NotImplemented",
      });
      render(<PageBody objectId="obj-1" />);
      const alert = await screen.findByRole("alert", {}, { timeout: SLOW });
      expect(alert.textContent).toBe("Esta función todavía no está disponible.");
    },
    SLOW,
  );

  it(
    "does not carry a load error over to the next page (keyed by object id)",
    async () => {
      vi.mocked(commands.objectLoadDoc)
        .mockResolvedValueOnce({ status: "error", error: "NotImplemented" })
        .mockResolvedValue({ status: "ok", data: [0, 0] });
      const { rerender, container } = render(<PageBody key="obj-1" objectId="obj-1" />);
      await screen.findByRole("alert", {}, { timeout: SLOW });
      rerender(<PageBody key="obj-2" objectId="obj-2" />);
      await vi.waitFor(() => expect(container.querySelector(".fossil-editor")).not.toBeNull(), {
        timeout: SLOW,
      });
      expect(screen.queryByRole("alert")).toBeNull();
      expect(commands.objectLoadDoc).toHaveBeenLastCalledWith("obj-2");
    },
    SLOW,
  );

  it(
    "destroys its Y.Doc on unmount",
    async () => {
      vi.mocked(commands.objectLoadDoc).mockResolvedValue({ status: "ok", data: [0, 0] });
      const destroy = vi.spyOn(Y.Doc.prototype, "destroy");
      const { unmount, container } = render(<PageBody objectId="obj-1" />);
      await vi.waitFor(() => expect(container.querySelector(".fossil-editor")).not.toBeNull(), {
        timeout: SLOW,
      });
      const before = destroy.mock.calls.length;
      unmount();
      expect(destroy.mock.calls.length).toBeGreaterThan(before);
      destroy.mockRestore();
    },
    SLOW,
  );
});
