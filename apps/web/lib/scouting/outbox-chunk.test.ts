import { describe, expect, it, vi } from "vitest";
import {
  LEGACY_MAX_BATCH,
  OUTBOX_CHUNK_SIZE,
  chunkOutbox,
  classifyChunkEntries,
  drainOutboxChunks,
  isolateFailedChunk,
  isPermanentOutboxFailure,
  isPermanentOutboxStatus,
  parseOutboxChunkBody,
  type OutboxChunkOutcome,
} from "./outbox-chunk";

type Row = { clientId: string; label?: string };

function rows(count: number, prefix = "entry"): Row[] {
  return Array.from({ length: count }, (_, index) => ({ clientId: `${prefix}-${index}` }));
}

function ok(ids: string[]): OutboxChunkOutcome {
  return {
    acknowledgements: ids.map((clientId) => ({ clientId })),
    rejected: [],
  };
}

describe("chunkOutbox", () => {
  it("keeps every weekend slice under the 100-entry server cap", () => {
    const weekend = rows(237);
    const batches = chunkOutbox(weekend);
    expect(batches).toHaveLength(Math.ceil(237 / OUTBOX_CHUNK_SIZE));
    for (const batch of batches) {
      expect(batch.length).toBeGreaterThan(0);
      expect(batch.length).toBeLessThanOrEqual(OUTBOX_CHUNK_SIZE);
      expect(batch.length).toBeLessThanOrEqual(LEGACY_MAX_BATCH);
    }
    expect(batches.at(-1)).toHaveLength(237 % OUTBOX_CHUNK_SIZE);
  });

  it("preserves order and never invents rows", () => {
    const items = rows(120);
    expect(chunkOutbox(items).flat()).toEqual(items);
    expect(chunkOutbox([])).toEqual([]);
  });

  it("honors a custom size and rejects nonsense sizes", () => {
    expect(chunkOutbox([1, 2, 3], 2)).toEqual([[1, 2], [3]]);
    expect(chunkOutbox([1, 2, 3], 0).flat()).toEqual([1, 2, 3]);
    expect(chunkOutbox([1, 2, 3], Number.NaN).flat()).toEqual([1, 2, 3]);
  });

  it("stays comfortably under the legacy 100-entry server cap", () => {
    expect(OUTBOX_CHUNK_SIZE).toBeLessThanOrEqual(LEGACY_MAX_BATCH);
    expect(OUTBOX_CHUNK_SIZE).toBe(50);
  });
});

describe("isolateFailedChunk", () => {
  it("halves a failed batch so the poison can be found", () => {
    const chunk = rows(5);
    expect(isolateFailedChunk(chunk)).toEqual([chunk.slice(0, 3), chunk.slice(3)]);
  });

  it("leaves a singleton as-is and invents nothing for an empty slice", () => {
    expect(isolateFailedChunk([{ clientId: "only" }])).toEqual([[{ clientId: "only" }]]);
    expect(isolateFailedChunk([])).toEqual([]);
  });
});

describe("isPermanentOutboxFailure", () => {
  it("treats 4xx batch ceilings as permanent so we bisect instead of looping", () => {
    expect(isPermanentOutboxStatus(400)).toBe(true);
    expect(isPermanentOutboxStatus(413)).toBe(true);
    expect(isPermanentOutboxStatus(408)).toBe(false);
    expect(isPermanentOutboxStatus(429)).toBe(false);
    expect(isPermanentOutboxStatus(500)).toBe(false);
    expect(isPermanentOutboxFailure(new Error("entries must contain at most 100 items"))).toBe(true);
    expect(isPermanentOutboxFailure(new Error("Sync failed (400)"))).toBe(true);
    expect(isPermanentOutboxFailure(new Error("Sync failed (503)"))).toBe(false);
    expect(isPermanentOutboxFailure(new Error("flaky venue wifi"))).toBe(false);
  });
});

describe("parseOutboxChunkBody", () => {
  it("reads per-entry results from a new server", () => {
    const outcome = parseOutboxChunkBody({
      acknowledgements: [{ clientId: "good-1", validations: [] }, { clientId: "good-2" }],
      accepted: ["good-1", "good-2"],
      rejected: [{ clientId: "bad-1", reason: "climb is required" }],
    });
    expect(outcome.acknowledgements.map((ack) => ack.clientId)).toEqual(["good-1", "good-2"]);
    expect(outcome.rejected).toEqual([{ clientId: "bad-1", reason: "climb is required" }]);
  });

  it("feature-detects an old server that only sends acknowledgements", () => {
    const outcome = parseOutboxChunkBody({ acknowledgements: [{ clientId: "good-1" }] });
    expect(outcome.acknowledgements.map((ack) => ack.clientId)).toEqual(["good-1"]);
    expect(outcome.rejected).toEqual([]);
  });

  it("never crashes on malformed bodies and never invents clientIds", () => {
    expect(parseOutboxChunkBody(null)).toEqual({ acknowledgements: [], rejected: [] });
    expect(parseOutboxChunkBody("nope")).toEqual({ acknowledgements: [], rejected: [] });
    expect(parseOutboxChunkBody({ acknowledgements: "x", rejected: 4 })).toEqual({
      acknowledgements: [],
      rejected: [],
    });
  });

  it("drops rows without a usable clientId and fills a default reason", () => {
    const outcome = parseOutboxChunkBody({
      acknowledgements: [{ clientId: "" }, { validations: [] }, { clientId: "kept" }],
      rejected: [{ clientId: "", reason: "x" }, { reason: "y" }, { clientId: "bad", reason: "  " }],
    });
    expect(outcome.acknowledgements.map((ack) => ack.clientId)).toEqual(["kept"]);
    expect(outcome.rejected).toEqual([{ clientId: "bad", reason: "Server rejected this entry" }]);
  });
});

describe("classifyChunkEntries", () => {
  it("maps acks and rejects onto the sent chunk only", () => {
    const chunk = rows(3);
    const classified = classifyChunkEntries(chunk, {
      acknowledgements: [
        { clientId: "entry-0" },
        { clientId: "invented-server-id" },
        { clientId: "entry-1" },
      ],
      rejected: [{ clientId: "entry-2", reason: "climb is required" }],
    });
    expect(classified.accepted.map((row) => row.entry.clientId)).toEqual(["entry-0", "entry-1"]);
    expect(classified.rejected).toEqual([{ entry: chunk[2], reason: "climb is required" }]);
    expect(classified.unresolved).toEqual([]);
  });

  it("leaves unanswered rows unresolved instead of inventing a success", () => {
    const chunk = rows(2);
    const classified = classifyChunkEntries(chunk, {
      acknowledgements: [{ clientId: "entry-0" }],
      rejected: [],
    });
    expect(classified.accepted.map((row) => row.entry.clientId)).toEqual(["entry-0"]);
    expect(classified.unresolved).toEqual([chunk[1]]);
  });
});

describe("drainOutboxChunks", () => {
  it("does not call push on an empty outbox and invents nothing", async () => {
    const push = vi.fn();
    const result = await drainOutboxChunks([], push);
    expect(push).not.toHaveBeenCalled();
    expect(result).toEqual({ accepted: [], rejected: [], isolated: [], remaining: [] });
  });

  it("drains a 120-entry weekend in ≤50-entry batches", async () => {
    const queued = rows(120);
    const push = vi.fn(async (chunk: Row[]) => {
      expect(chunk.length).toBeLessThanOrEqual(OUTBOX_CHUNK_SIZE);
      return ok(chunk.map((row) => row.clientId));
    });
    const result = await drainOutboxChunks(queued, push);
    expect(push).toHaveBeenCalledTimes(3);
    expect(result.accepted.map((row) => row.entry.clientId)).toEqual(
      queued.map((row) => row.clientId),
    );
    expect(result.rejected).toEqual([]);
    expect(result.isolated).toEqual([]);
    expect(result.remaining).toEqual([]);
  });

  it("quarantines one per-entry reject without dropping the rest of the chunk", async () => {
    const queued = rows(4);
    const push = vi.fn(async (chunk: Row[]) => ({
      acknowledgements: chunk
        .filter((row) => row.clientId !== "entry-1")
        .map((row) => ({ clientId: row.clientId })),
      rejected: [{ clientId: "entry-1", reason: "climb is required" }],
    }));
    const result = await drainOutboxChunks(queued, push);
    expect(result.accepted.map((row) => row.entry.clientId)).toEqual([
      "entry-0",
      "entry-2",
      "entry-3",
    ]);
    expect(result.rejected).toEqual([{ entry: queued[1], reason: "climb is required" }]);
    expect(result.isolated).toEqual([]);
    expect(result.remaining).toEqual([]);
  });

  it("bisects an all-or-nothing 400 so one poison does not drop the regional weekend", async () => {
    const queued = rows(5);
    const poison = "entry-2";
    const push = vi.fn(async (chunk: Row[]) => {
      if (chunk.some((row) => row.clientId === poison)) {
        throw new Error("Sync failed (400)");
      }
      return ok(chunk.map((row) => row.clientId));
    });
    const result = await drainOutboxChunks(queued, push);
    expect(result.accepted.map((row) => row.entry.clientId)).toEqual([
      "entry-0",
      "entry-1",
      "entry-3",
      "entry-4",
    ]);
    expect(result.isolated).toEqual([
      { entry: queued[2], reason: "Sync failed (400)" },
    ]);
    expect(result.rejected).toEqual([]);
    expect(result.remaining).toEqual([]);
  });

  it("keeps draining later weekend chunks after an earlier chunk fails", async () => {
    const queued = rows(120);
    const poison = "entry-3";
    const push = vi.fn(async (chunk: Row[]) => {
      if (chunk.some((row) => row.clientId === poison)) {
        throw new Error("entries must contain at most 100 items");
      }
      return ok(chunk.map((row) => row.clientId));
    });
    const result = await drainOutboxChunks(queued, push);
    expect(result.isolated).toEqual([{ entry: queued[3], reason: "entries must contain at most 100 items" }]);
    expect(result.accepted.map((row) => row.entry.clientId)).toEqual(
      queued.filter((row) => row.clientId !== poison).map((row) => row.clientId),
    );
    expect(result.accepted).toHaveLength(119);
    expect(result.remaining).toEqual([]);
    expect(push.mock.calls.some((call) => call[0][0]?.clientId === "entry-50")).toBe(true);
    expect(push.mock.calls.some((call) => call[0][0]?.clientId === "entry-100")).toBe(true);
  });

  it("continues the weekend when a transient chunk error leaves that slice queued", async () => {
    const queued = rows(120);
    const push = vi.fn(async (chunk: Row[]) => {
      if (chunk[0]?.clientId === "entry-0") {
        throw new Error("flaky venue wifi");
      }
      return ok(chunk.map((row) => row.clientId));
    });
    const result = await drainOutboxChunks(queued, push);
    expect(push).toHaveBeenCalledTimes(3);
    expect(result.remaining.map((row) => row.clientId)).toEqual(
      queued.slice(0, OUTBOX_CHUNK_SIZE).map((row) => row.clientId),
    );
    expect(result.accepted).toHaveLength(70);
    expect(result.isolated).toEqual([]);
  });

  it("ignores server acks for clientIds that were never queued", async () => {
    const queued = rows(2);
    const result = await drainOutboxChunks(queued, async () => ({
      acknowledgements: [{ clientId: "ghost-from-server" }, { clientId: "entry-0" }],
      rejected: [{ clientId: "also-ghost", reason: "nope" }],
    }));
    expect(result.accepted.map((row) => row.entry.clientId)).toEqual(["entry-0"]);
    expect(result.rejected).toEqual([]);
    expect(result.remaining.map((row) => row.clientId)).toEqual(["entry-1"]);
  });
});
