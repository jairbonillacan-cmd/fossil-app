import type { DocTransport } from "@fossil/editor";
import type { CoreError, ObjectId } from "./bindings";
import { commands } from "./bindings";

/** Thrown when the vault rejects a body load or update; carries the typed error. */
export class DocTransportError extends Error {
  readonly error: CoreError;

  constructor(error: CoreError) {
    super(typeof error === "string" ? error : JSON.stringify(error));
    this.error = error;
  }
}

/**
 * Persistence bridge between `@fossil/editor` and the vault (#58): the body is
 * the object's Yjs document, loaded with `object_load_doc` and appended to with
 * `object_apply_update` (lib0 v1 updates, validated and stored by `doc_store`).
 * Create one per object and keep it stable (the editor reloads when it changes).
 */
export function createObjectTransport(id: ObjectId): DocTransport {
  return {
    async load() {
      const result = await commands.objectLoadDoc(id);
      if (result.status === "error") throw new DocTransportError(result.error);
      return Uint8Array.from(result.data);
    },
    async apply(update) {
      const result = await commands.objectApplyUpdate(id, Array.from(update));
      if (result.status === "error") throw new DocTransportError(result.error);
    },
  };
}
