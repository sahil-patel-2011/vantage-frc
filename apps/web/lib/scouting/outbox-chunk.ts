/**
 * Scout outbox chunking + failure isolation.
 *
 * A two-day regional routinely queues 200–400 rows. The sync route still
 * rejects a single POST over 100 (legacy clients), and an all-or-nothing
 * server used to roll back every good entry behind one poisoned payload.
 * This module slices the queue and isolates failures so one bad row cannot
 * drop Saturday + Sunday.
 *
 * Pure: no IndexedDB, no fetch, no invented entries. It only rearranges and
 * classifies what the caller already queued.
 */

/** Weekend drain posts slices this size so no batch trips the 100-entry cap. */
export const OUTBOX_CHUNK_SIZE = 50;

/** Legacy `/api/scouting/sync` ceiling when `resultsMode` is omitted. */
export const LEGACY_MAX_BATCH = 100;

/** @deprecated Use OUTBOX_CHUNK_SIZE. Kept so scout-offline re-exports stay stable. */
export const SYNC_BATCH_SIZE = OUTBOX_CHUNK_SIZE;

export type OutboxChunkId = { clientId: string };

export type OutboxChunkValidation = {
  fieldKey: string;
  status: string;
  scoutValue: unknown;
  officialValue: unknown;
  officialSource: string;
  detail: string;
  soft?: boolean;
};

export type OutboxChunkAck = {
  clientId: string;
  validations?: OutboxChunkValidation[];
};

export type OutboxChunkRejection = {
  clientId: string;
  reason: string;
};

export type OutboxChunkOutcome = {
  acknowledgements: OutboxChunkAck[];
  rejected: OutboxChunkRejection[];
};

export type OutboxDrainAccepted<T extends OutboxChunkId> = {
  entry: T;
  acknowledgement: OutboxChunkAck;
};

export type OutboxDrainRejected<T extends OutboxChunkId> = {
  entry: T;
  reason: string;
};

/**
 * Why rows stayed queued, so the page can say what happened instead of "Sent":
 * - `signed-out`: the server answered 401. Retrying cannot help until the scout signs in again.
 * - `server`: the server answered with an error it may not repeat (5xx, 429, 408).
 * - `unreachable`: no answer at all (timeout, dropped connection, captive portal).
 */
export type OutboxFailureKind = "signed-out" | "server" | "unreachable";

export type OutboxDrainResult<T extends OutboxChunkId> = {
  accepted: OutboxDrainAccepted<T>[];
  rejected: OutboxDrainRejected<T>[];
  /** Singletons that failed all-or-nothing — quarantine, do not retry the weekend. */
  isolated: OutboxDrainRejected<T>[];
  /** Transient / unanswered — stay queued. Never fabricated. */
  remaining: T[];
  /** Why `remaining` is not empty, from the last failed POST; null when nothing failed. */
  failure: OutboxFailureKind | null;
};

/**
 * A sync POST the server answered with an error status. The status, not the wording, decides
 * whether the rows are set aside or kept: it used to be read back out of the message with a
 * `(4xx)` pattern the route never sent, so a 403 counted as "try again later" forever.
 */
export class OutboxPushError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** The server's machine reason (`view_only`), when it sent one. */
    readonly reason: string | null = null,
  ) {
    super(message);
    this.name = "OutboxPushError";
  }
}

function statusOf(error: unknown): number | null {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === "number" && Number.isInteger(status) && status > 0 ? status : null;
}

/**
 * Slice queued rows into POST-sized batches. Preserves order. Last slice may
 * be short. Never invents rows — an empty outbox yields no batches.
 */
export function chunkOutbox<T>(
  items: readonly T[],
  size: number = OUTBOX_CHUNK_SIZE,
): T[][] {
  const chunkSize = Number.isFinite(size) && size >= 1 ? Math.floor(size) : OUTBOX_CHUNK_SIZE;
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += chunkSize) {
    batches.push(items.slice(index, index + chunkSize));
  }
  return batches;
}

/** @deprecated Use chunkOutbox. */
export const sliceIntoBatches = chunkOutbox;

/**
 * When an all-or-nothing POST fails, split so the next attempt can find the
 * poisoned row without abandoning the rest of the chunk. A singleton stays
 * a singleton (caller quarantines it).
 */
export function isolateFailedChunk<T>(chunk: readonly T[]): T[][] {
  if (chunk.length <= 1) return chunk.length === 0 ? [] : [chunk.slice()];
  const mid = Math.ceil(chunk.length / 2);
  return [chunk.slice(0, mid), chunk.slice(mid)];
}

/**
 * 4xx except retryable timeouts / rate limits — bisect or quarantine, don't loop the weekend.
 * 401 is not the entry's fault either: the session ended, and the same rows go through once the
 * scout signs in again.
 */
export function isPermanentOutboxStatus(status: number): boolean {
  return status >= 400 && status < 500 && status !== 401 && status !== 408 && status !== 429;
}

export function isPermanentOutboxFailure(error: unknown): boolean {
  const status = statusOf(error);
  if (status !== null) return isPermanentOutboxStatus(status);
  const message = error instanceof Error ? error.message : String(error ?? "");
  const statusMatch = message.match(/\((\d{3})\)/);
  if (statusMatch) {
    const parsed = Number(statusMatch[1]);
    if (Number.isInteger(parsed)) return isPermanentOutboxStatus(parsed);
  }
  if (/at most \d+ items/i.test(message)) return true;
  return false;
}

/**
 * A refusal that is about the person, not about any one row: View only (403 `view_only`) or
 * a session that ended (401). Splitting the batch to find a "poisoned" row would only send the
 * same refusal once per row.
 */
export function isWholeBatchRefusal(error: unknown): boolean {
  const status = statusOf(error);
  if (status === 401) return true;
  return status === 403 && (error as { reason?: unknown } | null)?.reason === "view_only";
}

/** What to tell the scout about rows that stayed queued after this error. */
export function outboxFailureKind(error: unknown): OutboxFailureKind {
  const status = statusOf(error);
  if (status === 401) return "signed-out";
  if (status !== null) return "server";
  return "unreachable";
}

/**
 * Feature-detect sync bodies. Per-entry servers return `{ acknowledgements, rejected }`;
 * older deployments return only acknowledgements. Extra / blank clientIds are dropped —
 * never turned into invented entries.
 */
export function parseOutboxChunkBody(body: unknown): OutboxChunkOutcome {
  const record = (body ?? {}) as {
    acknowledgements?: Array<{ clientId?: unknown; validations?: OutboxChunkValidation[] }>;
    rejected?: Array<{ clientId?: unknown; reason?: unknown }>;
  };
  const acknowledgements = (Array.isArray(record.acknowledgements) ? record.acknowledgements : [])
    .filter((ack): ack is OutboxChunkAck => typeof ack?.clientId === "string" && ack.clientId.length > 0);
  const rejected = (Array.isArray(record.rejected) ? record.rejected : [])
    .filter((row) => typeof row?.clientId === "string" && row.clientId.length > 0)
    .map((row) => ({
      clientId: row.clientId as string,
      reason:
        typeof row.reason === "string" && row.reason.trim()
          ? row.reason
          : "Server rejected this entry",
    }));
  return { acknowledgements, rejected };
}

/** @deprecated Use parseOutboxChunkBody. */
export const parseSyncResponseBody = parseOutboxChunkBody;

function firstByClientId<T extends OutboxChunkId>(chunk: readonly T[]): Map<string, T> {
  const map = new Map<string, T>();
  for (const entry of chunk) {
    if (typeof entry.clientId === "string" && entry.clientId && !map.has(entry.clientId)) {
      map.set(entry.clientId, entry);
    }
  }
  return map;
}

/**
 * Map a server outcome onto the chunk the caller actually sent.
 * ClientIds that were not in the chunk are ignored (never invented).
 * Rows with no ack and no reject stay unresolved for a later pass.
 */
export function classifyChunkEntries<T extends OutboxChunkId>(
  chunk: readonly T[],
  outcome: OutboxChunkOutcome,
): {
  accepted: OutboxDrainAccepted<T>[];
  rejected: OutboxDrainRejected<T>[];
  unresolved: T[];
} {
  const byId = firstByClientId(chunk);
  const settled = new Set<string>();
  const accepted: OutboxDrainAccepted<T>[] = [];
  const rejected: OutboxDrainRejected<T>[] = [];

  for (const acknowledgement of outcome.acknowledgements) {
    const entry = byId.get(acknowledgement.clientId);
    if (!entry || settled.has(acknowledgement.clientId)) continue;
    settled.add(acknowledgement.clientId);
    accepted.push({ entry, acknowledgement });
  }
  for (const row of outcome.rejected) {
    const entry = byId.get(row.clientId);
    if (!entry || settled.has(row.clientId)) continue;
    settled.add(row.clientId);
    rejected.push({ entry, reason: row.reason });
  }

  const unresolved: T[] = [];
  for (const entry of chunk) {
    if (!entry.clientId || settled.has(entry.clientId)) continue;
    if (!byId.has(entry.clientId)) continue;
    // Duplicate clientIds after the first stay out of unresolved — the first
    // copy already represents that id.
    if (byId.get(entry.clientId) !== entry) continue;
    unresolved.push(entry);
  }
  return { accepted, rejected, unresolved };
}

function failureReason(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  return "Sync failed";
}

/**
 * Drain queued entries in ≤50-row POSTs. A per-entry response accepts/rejects
 * inside a chunk; an all-or-nothing throw bisects until the poisoned row is
 * isolated. Later chunks still run — one bad entry cannot drop the weekend.
 */
export async function drainOutboxChunks<T extends OutboxChunkId>(
  entries: readonly T[],
  push: (chunk: T[]) => Promise<OutboxChunkOutcome>,
): Promise<OutboxDrainResult<T>> {
  const accepted: OutboxDrainAccepted<T>[] = [];
  const rejected: OutboxDrainRejected<T>[] = [];
  const isolated: OutboxDrainRejected<T>[] = [];
  const remaining: T[] = [];
  let failure: OutboxFailureKind | null = null;
  // Signed out: every later chunk would get the same 401, so they wait without being sent.
  let halted = false;

  const drainSlice = async (slice: readonly T[]): Promise<void> => {
    if (slice.length === 0) return;
    if (halted) {
      remaining.push(...slice);
      return;
    }
    try {
      const outcome = await push(slice.slice());
      const classified = classifyChunkEntries(slice, outcome);
      accepted.push(...classified.accepted);
      rejected.push(...classified.rejected);
      remaining.push(...classified.unresolved);
    } catch (error) {
      if (isWholeBatchRefusal(error)) {
        if (statusOf(error) === 401) {
          failure = "signed-out";
          halted = true;
          remaining.push(...slice);
        } else {
          // View only: the same answer for every row. Set them aside with the server's
          // sentence, once, so the phone stops sending them every 45 seconds.
          for (const entry of slice) isolated.push({ entry, reason: failureReason(error) });
        }
        return;
      }
      if (!isPermanentOutboxFailure(error)) failure = outboxFailureKind(error);
      if (slice.length === 1) {
        const entry = slice[0]!;
        if (isPermanentOutboxFailure(error)) {
          isolated.push({ entry, reason: failureReason(error) });
        } else {
          remaining.push(entry);
        }
        return;
      }
      if (isPermanentOutboxFailure(error)) {
        for (const half of isolateFailedChunk(slice)) {
          await drainSlice(half);
        }
        return;
      }
      remaining.push(...slice);
    }
  };

  for (const batch of chunkOutbox(entries)) {
    await drainSlice(batch);
  }

  return { accepted, rejected, isolated, remaining, failure };
}
