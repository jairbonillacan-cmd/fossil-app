import Link from "@tiptap/extension-link";

/** Only web links are kept; anything else (files, network shares, app schemes) renders without an href. */
export const isWebUri = (uri: string): boolean => /^https?:\/\/[^/\\]/i.test(uri.trim());

const REL = "noopener noreferrer nofollow";

/** `target`/`rel` stored in a document are ignored: every link renders with the safe values. */
const fixed = (name: "target" | "rel", value: string) => ({
  default: value,
  parseHTML: () => value,
  renderHTML: () => ({ [name]: value }),
});

/**
 * Link mark that replaces StarterKit's. Pages may come from anywhere, so a
 * link never navigates the app window: clicking does nothing inside the
 * editor and only http(s) targets are rendered.
 */
export const SafeLink = Link.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      target: fixed("target", "_blank"),
      rel: fixed("rel", REL),
    };
  },
}).configure({
  openOnClick: false,
  HTMLAttributes: { target: "_blank", rel: REL },
  isAllowedUri: (uri) => isWebUri(uri),
});
