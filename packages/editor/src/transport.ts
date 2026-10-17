import * as Y from "yjs";

/** State of the Yjs transport batcher shown as Guardado / Guardando / Error (#160, #164). */
export type SaveStatusKind = "Saved" | "Saving" | "Error";

/** Batcher status: `Saved` only when every sent delta was acknowledged (#160, #164). */
export type SaveStatus = {
  kind: SaveStatusKind;
  /** Sequence of the first delta that failed, when `kind` is `Error`. */
  failed_seq: number | null;
  last_error: string | null;
};

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
  flush(): Promise<void>;
  /** Retries persisting any failed or pending updates immediately (#164). */
  retry(): Promise<void>;
  /** Current save status derived from pushed vs acknowledged deltas (#164). */
  status(): SaveStatus;
  /** Flushes pending updates and detaches window listeners. */
  dispose(): void;
}

export interface UpdateBatcherOptions {
  /** Coalescing window in ms (issue #23 asks for 250). */
  delayMs?: number;
  /** Called when `apply` rejects; without it the error is dropped. */
  onError?: (error: unknown) => void;
  /** Called whenever `SaveStatus` changes (#164). */
  onStatusChange?: (status: SaveStatus) => void;
}

interface PendingBatch {
  update: Uint8Array;
  firstSeq: number;
  lastSeq: number;
}

/** Coalesces Yjs updates and sends them to the transport every `delayMs` ms. */
export function createUpdateBatcher(
  transport: DocTransport,
  options: UpdateBatcherOptions = {},
): UpdateBatcher {
  const delayMs = options.delayMs ?? 250;
  const onError = options.onError;
  const onStatusChange = options.onStatusChange;
  let pending: PendingBatch[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let chain: Promise<void> = Promise.resolve();
  let pushedSeq = 0;
  let ackedSeq = 0;
  let inFlight = 0;
  let failedSeq: number | null = null;
  let lastError: string | null = null;
  let currentStatus: SaveStatus = { kind: "Saved", failed_seq: null, last_error: null };

  const status = (): SaveStatus => {
    if (failedSeq !== null) {
      return { kind: "Error", failed_seq: failedSeq, last_error: lastError };
    }
    if (ackedSeq < pushedSeq || pending.length > 0 || inFlight > 0) {
      return { kind: "Saving", failed_seq: null, last_error: null };
    }
    return { kind: "Saved", failed_seq: null, last_error: null };
  };

  const emitStatus = (): void => {
    const next = status();
    if (
      next.kind !== currentStatus.kind ||
      next.failed_seq !== currentStatus.failed_seq ||
      next.last_error !== currentStatus.last_error
    ) {
      currentStatus = next;
      onStatusChange?.(next);
    }
  };

  const reinsertPending = (entry: PendingBatch): void => {
    const idx = pending.findIndex((item) => item.firstSeq > entry.firstSeq);
    if (idx === -1) pending.push(entry);
    else pending.splice(idx, 0, entry);
  };

  const send = (): Promise<void> => {
    const batch = pending;
    const first = batch[0];
    if (first === undefined) return chain;
    const last = batch[batch.length - 1] ?? first;
    pending = [];
    const merged =
      batch.length === 1 ? first.update : Y.mergeUpdates(batch.map((item) => item.update));
    const firstSeq = first.firstSeq;
    const lastSeq = last.lastSeq;
    inFlight += 1;
    // Chained so updates reach storage in order even when one apply is slow.
    chain = chain
      .then(async () => {
        try {
          if (failedSeq !== null && failedSeq < firstSeq) {
            reinsertPending({ update: merged, firstSeq, lastSeq });
            return;
          }
          await transport.apply(merged);
          ackedSeq = Math.max(ackedSeq, lastSeq);
          if (failedSeq !== null && ackedSeq >= failedSeq) {
            failedSeq = null;
            lastError = null;
          }
        } catch (error: unknown) {
          reinsertPending({ update: merged, firstSeq, lastSeq });
          if (failedSeq === null || firstSeq < failedSeq) {
            failedSeq = firstSeq;
          }
          lastError = error instanceof Error ? error.message : String(error);
          throw error;
        } finally {
          inFlight -= 1;
          emitStatus();
        }
      })
      .catch((error: unknown) => {
        onError?.(error);
      });
    return chain;
  };

  const flush = (): Promise<void> => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (pending.length > 0) return send();
    return chain;
  };

  const onPageHide = (): void => {
    void flush();
  };

  if (typeof window !== "undefined") {
    window.addEventListener("pagehide", onPageHide);
  }

  return {
    push(update: Uint8Array): void {
      const seq = ++pushedSeq;
      pending.push({ update, firstSeq: seq, lastSeq: seq });
      if (timer === null) {
        timer = setTimeout(() => {
          timer = null;
          void send();
        }, delayMs);
      }
      emitStatus();
    },
    flush,
    retry: flush,
    status,
    dispose(): void {
      if (typeof window !== "undefined") {
        window.removeEventListener("pagehide", onPageHide);
      }
      void flush();
    },
  };
}
