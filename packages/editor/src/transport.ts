import * as Y from "yjs";

/** Persistence bridge for the object body (`object_load_doc` / `object_apply_update`, #18). */
export interface DocTransport {
  /** Full Yjs state of the body, as returned by `object_load_doc`. */
  load(): Promise<Uint8Array>;
  /** Persists one batched local update, as sent to `object_apply_update`. */
  apply(update: Uint8Array): Promise<void>;
  /** Stores a pasted or dropped image in `attachments/` and returns its relative path (#5). */
  saveAttachment?(fileName: string, bytes: Uint8Array): Promise<string>;
  /** Reads an attachment's bytes by its `attachments/<name>.<ext>` relative path (#5). */
  loadAttachment?(path: string): Promise<Uint8Array>;
}

export interface UpdateBatcher {
  /** Queues one Yjs update; sends the merged batch after the delay. */
  push(update: Uint8Array): void;
  /** Sends whatever is pending right now. */
  flush(): void;
}

export interface UpdateBatcherOptions {
  /** Coalescing window in ms (issue #23 asks for 250). */
  delayMs?: number;
  /** Called when `apply` rejects; without it the error is dropped. */
  onError?: (error: unknown) => void;
}

/** Coalesces Yjs updates and sends them to the transport every `delayMs` ms. */
export function createUpdateBatcher(
  transport: DocTransport,
  options: UpdateBatcherOptions = {},
): UpdateBatcher {
  const delayMs = options.delayMs ?? 250;
  const onError = options.onError;
  let pending: Uint8Array[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let chain: Promise<void> = Promise.resolve();

  const send = (): void => {
    const merged = Y.mergeUpdates(pending);
    pending = [];
    // Chained so updates reach storage in order even when one apply is slow.
    chain = chain
      .then(() => transport.apply(merged))
      .catch((error: unknown) => {
        onError?.(error);
      });
  };

  return {
    push(update: Uint8Array): void {
      pending.push(update);
      if (timer === null) {
        timer = setTimeout(() => {
          timer = null;
          send();
        }, delayMs);
      }
    },
    flush(): void {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      if (pending.length > 0) send();
    },
  };
}
