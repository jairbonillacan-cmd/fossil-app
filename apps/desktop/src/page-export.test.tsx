import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ObjectMeta } from "./bindings";
import { commands } from "./bindings";
import { PageEditor } from "./page-editor";
import { markdownFileName } from "./page-export";
import "./i18n";

vi.mock("./page-body", () => ({ PageBody: () => null }));

vi.mock("./bindings", () => ({
  commands: {
    objectUpdateMeta: vi.fn(),
    objectExportMarkdown: vi.fn(),
  },
}));

const page: ObjectMeta = {
  id: "obj-1",
  types: ["Page"],
  title: "Plan: Q4",
  icon: null,
  parent: null,
  created_at: "2026-10-14T03:00:00.000Z",
  updated_at: "2026-10-14T03:00:00.000Z",
  archived: false,
};

const MIRROR = '---\nid: "obj-1"\ntypes: ["Page"]\n---\n\nCuerpo de la página\n';

describe("Export Markdown", () => {
  let clicked: HTMLAnchorElement[];
  let blobs: Blob[];

  beforeEach(() => {
    vi.clearAllMocks();
    clicked = [];
    blobs = [];
    URL.createObjectURL = vi.fn((blob: Blob) => {
      blobs.push(blob);
      return "blob:fossil/1";
    });
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicked.push(this);
    });
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("downloads exactly what object_export_markdown returns, body included", async () => {
    vi.mocked(commands.objectExportMarkdown).mockResolvedValue({ status: "ok", data: MIRROR });
    render(<PageEditor object={page} />);
    fireEvent.click(screen.getByRole("button", { name: "Más acciones" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Exportar Markdown" }));
    await vi.waitFor(() => expect(clicked).toHaveLength(1));
    expect(commands.objectExportMarkdown).toHaveBeenCalledWith("obj-1");
    expect(clicked[0]?.download).toBe("Plan- Q4.md");
    expect(await blobs[0]?.text()).toBe(MIRROR);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:fossil/1");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows an error and downloads nothing when the export fails", async () => {
    vi.mocked(commands.objectExportMarkdown).mockResolvedValue({
      status: "error",
      error: { ObjectNotFound: "obj-1" },
    });
    render(<PageEditor object={page} />);
    fireEvent.click(screen.getByRole("button", { name: "Más acciones" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Exportar Markdown" }));
    expect((await screen.findByRole("alert")).textContent).toContain("No se pudo exportar");
    expect(clicked).toHaveLength(0);
  });

  it("prints the page in the light theme and restores the shell theme", () => {
    document.documentElement.dataset.theme = "dark";
    let themeWhilePrinting: string | undefined;
    const print = vi.spyOn(window, "print").mockImplementation(() => {
      themeWhilePrinting = document.documentElement.dataset.theme;
    });
    render(<PageEditor object={page} />);
    fireEvent.click(screen.getByRole("button", { name: "Más acciones" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Exportar PDF" }));
    expect(print).toHaveBeenCalledOnce();
    expect(themeWhilePrinting).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("dark");
    delete document.documentElement.dataset.theme;
  });

  it("names files like the mirror: Windows-safe, reserved names and empty titles", () => {
    expect(markdownFileName('a<b>c:"d"/e\\f|g?h*', "x")).toBe("a-b-c--d--e-f-g-h-.md");
    expect(markdownFileName("Notas. ", "x")).toBe("Notas.md");
    expect(markdownFileName("con.txt", "x")).toBe("_con.txt.md");
    expect(markdownFileName("   ", "obj-1")).toBe("obj-1.md");
  });

  it("waits for an in-flight title save before calling object_export_markdown (#51)", async () => {
    const order: string[] = [];
    let resolveSave!: () => void;
    vi.mocked(commands.objectUpdateMeta).mockImplementation(
      () =>
        new Promise((resolve) => {
          order.push("save:start");
          resolveSave = () => {
            order.push("save:done");
            resolve({ status: "ok", data: { ...page, title: "Plan final" } });
          };
        }),
    );
    vi.mocked(commands.objectExportMarkdown).mockImplementation(async () => {
      order.push("export");
      return { status: "ok", data: MIRROR };
    });

    render(<PageEditor object={page} />);
    const input = screen.getByRole("textbox", { name: "Título de la página" });
    fireEvent.change(input, { target: { value: "Plan final" } });
    fireEvent.click(screen.getByRole("button", { name: "Más acciones" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Exportar Markdown" }));
    expect(order).toEqual(["save:start"]);
    expect(commands.objectExportMarkdown).not.toHaveBeenCalled();

    resolveSave();
    await vi.waitFor(() => expect(clicked).toHaveLength(1));
    expect(order).toEqual(["save:start", "save:done", "export"]);
  });
});
