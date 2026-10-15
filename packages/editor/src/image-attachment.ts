import { mergeAttributes, Node } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import {
  defaultEditorTranslator,
  EDITOR_MESSAGES_ES_MX,
  type EditorTranslationKey,
  type EditorTranslator,
} from "./i18n";
import type { DocTransport } from "./transport";

const VALID_PATH = /^attachments\/[A-Za-z0-9][A-Za-z0-9._-]*\.(png|jpe?g|gif|webp)$/i;

/** Validates that `path` points strictly inside `attachments/<name>.<ext>` (#5). */
export const isValidAttachmentPath = (path: string): boolean =>
  VALID_PATH.test(path) && !path.includes("..");

/** Returns the image MIME type for a valid `attachments/` path, or `null` if rejected. */
export function mimeTypeForAttachment(path: string): string | null {
  if (!isValidAttachmentPath(path)) return null;
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  return `image/${ext === "jpg" ? "jpeg" : ext}`;
}

/** Ensures a pasted/dropped `File` has a supported image extension for `attachments::save`. */
export function fileNameForImage(file: File): string {
  const raw = file.name.trim();
  if (/\.(png|jpe?g|gif|webp)$/i.test(raw)) return raw;
  const sub = file.type.toLowerCase().split("/")[1] ?? "";
  const ext = sub === "jpeg" ? "jpg" : /^(png|gif|webp)$/.test(sub) ? sub : "png";
  return `${raw.length > 0 ? raw.replace(/\.[^.]+$/, "") : "image"}.${ext}`;
}

const label = (t: EditorTranslator, key: EditorTranslationKey): string =>
  t(key) === key ? EDITOR_MESSAGES_ES_MX[key] : t(key);

function extractImageFiles(data: DataTransfer | null | undefined): File[] {
  const fromItems = Array.from(data?.items ?? [])
    .map((i) => (i.kind === "file" ? i.getAsFile() : null))
    .filter((f): f is File => f !== null);
  const list = (data?.files?.length ?? 0) > 0 ? Array.from(data?.files ?? []) : fromItems;
  return list.filter(
    (f) => f.type.toLowerCase().startsWith("image/") || /\.(png|jpe?g|gif|webp)$/i.test(f.name),
  );
}

function insertImageBlock(view: EditorView, src: string, alt: string): void {
  const { state } = view;
  const node = state.schema.nodes.image?.create({ src, alt, blockId: crypto.randomUUID() });
  if (!node) return;
  const { $from } = state.selection;
  const isEmptyPara =
    $from.depth >= 1 && $from.node(1).type.name === "paragraph" && $from.node(1).content.size === 0;
  const at =
    $from.depth >= 1 ? (isEmptyPara ? $from.before(1) : $from.after(1)) : state.doc.content.size;
  view.dispatch(state.tr.insert(at, node));
}

export interface ImageAttachmentOptions {
  transport?: DocTransport | undefined;
  t: EditorTranslator;
  onError?: ((error: unknown) => void) | undefined;
}

/** Block-level `image` node backed by `fossil-core::attachments` (#5). */
export const ImageAttachment = Node.create<ImageAttachmentOptions>({
  name: "image",
  priority: 1000,
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,
  addOptions: () => ({ transport: undefined, t: defaultEditorTranslator, onError: undefined }),
  addAttributes: () => ({ src: { default: "" }, alt: { default: "" } }),
  parseHTML: () => [
    {
      tag: "figure[data-attachment-src],img[src]",
      getAttrs: (el) => {
        const src = el.getAttribute("data-attachment-src") ?? el.getAttribute("src") ?? "";
        return isValidAttachmentPath(src) ? { src, alt: el.getAttribute("alt") ?? "" } : false;
      },
    },
  ],
  renderHTML: ({ node, HTMLAttributes }) => [
    "figure",
    mergeAttributes(HTMLAttributes, {
      class: "fossil-image-block",
      "data-attachment-src": String(node.attrs.src ?? ""),
    }),
    ["img", { class: "fossil-image", alt: String(node.attrs.alt ?? "") }],
  ],
  addNodeView() {
    const { transport, t, onError } = this.options;
    return ({ node: initialNode }) => {
      let currentNode = initialNode;
      let destroyed = false;
      let loadSeq = 0;
      const dom = document.createElement("figure");
      dom.className = "fossil-image-block";
      dom.contentEditable = "false";
      const img = document.createElement("img");
      img.className = "fossil-image";
      img.draggable = false;
      const status = document.createElement("span");
      status.className = "fossil-image-status";
      dom.append(img, status);
      const setState = (state: "loading" | "ready" | "error", text: string, srcUrl?: string) => {
        dom.dataset.state = state;
        status.textContent = text;
        if (srcUrl) img.src = srcUrl;
        else img.removeAttribute("src");
      };
      const renderNode = (node: ProseMirrorNode, reload: boolean) => {
        if (typeof node.attrs.blockId === "string" && node.attrs.blockId)
          dom.dataset.blockId = node.attrs.blockId;
        const src = String(node.attrs.src ?? "");
        dom.dataset.attachmentSrc = src;
        img.alt = String(node.attrs.alt ?? "").trim() || label(t, "editor.image.alt");
        if (!reload) return;
        const mime = mimeTypeForAttachment(src);
        if (mime === null || typeof transport?.loadAttachment !== "function")
          return setState("error", label(t, "editor.image.error"));
        const seq = ++loadSeq;
        setState("loading", label(t, "editor.image.loading"));
        void transport
          .loadAttachment(src)
          .then((bytes) => {
            if (destroyed || seq !== loadSeq) return;
            let bin = "";
            for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i] ?? 0);
            setState("ready", "", `data:${mime};base64,${btoa(bin)}`);
          })
          .catch((err: unknown) => {
            if (!destroyed && seq === loadSeq) {
              setState("error", label(t, "editor.image.error"));
              onError?.(err);
            }
          });
      };
      renderNode(currentNode, true);
      return {
        dom,
        update(updatedNode) {
          if (updatedNode.type !== currentNode.type) return false;
          renderNode(updatedNode, updatedNode.attrs.src !== currentNode.attrs.src);
          currentNode = updatedNode;
          return true;
        },
        destroy() {
          destroyed = true;
        },
      };
    };
  },
  addProseMirrorPlugins() {
    const { transport, t, onError } = this.options;
    const handle = (view: EditorView, data: DataTransfer | null | undefined, e: Event): boolean => {
      const files = extractImageFiles(data);
      if (files.length === 0 || typeof transport?.saveAttachment !== "function") return false;
      const saveAttachment = transport.saveAttachment.bind(transport);
      e.preventDefault();
      void (async () => {
        for (const file of files) {
          try {
            const fileName = fileNameForImage(file);
            const savedPath = await saveAttachment(
              fileName,
              new Uint8Array(await file.arrayBuffer()),
            );
            if (!isValidAttachmentPath(savedPath)) throw new Error(`Invalid path: ${savedPath}`);
            const baseAlt = fileName.replace(/\.[^.]+$/, "").trim();
            insertImageBlock(view, savedPath, baseAlt || label(t, "editor.image.alt"));
          } catch (err: unknown) {
            onError?.(err);
          }
        }
      })();
      return true;
    };
    return [
      new Plugin({
        key: new PluginKey("fossilImageAttachment"),
        props: {
          handleDOMEvents: {
            paste: (v, e) => handle(v, e.clipboardData, e),
            drop: (v, e) => (v.dragging ? false : handle(v, e.dataTransfer, e)),
          },
        },
      }),
    ];
  },
});
