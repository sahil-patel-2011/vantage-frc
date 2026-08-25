import { describe, expect, it } from "vitest";
import {
  SYNC_BATCH_SIZE,
  parseSyncResponseBody,
  sliceIntoBatches,
} from "./scout-offline";

describe("sliceIntoBatches", () => {
  it("keeps every batch at or under the sync batch size", () => {
    // A two-day competition outbox: far over the old 100-entry server cap.
    const weekend = Array.from({ length: 237 }, (_, index) => ({ clientId: `entry-${index}` }));
    const batches = sliceIntoBatches(weekend);
    expect(batches).toHaveLength(Math.ceil(237 / SYNC_BATCH_SIZE));
    for (const batch of batches) expect(batch.length).toBeLessThanOrEqual(SYNC_BATCH_SIZE);
    expect(batches.at(-1)).toHaveLength(237 % SYNC_BATCH_SIZE);
  });

  it("preserves order across batches", () => {
    const items = Array.from({ length: 120 }, (_, index) => index);
    const flattened = sliceIntoBatches(items).flat();
    expect(flattened).toEqual(items);
  });

  it("returns no batches for an empty outbox", () => {
    expect(sliceIntoBatches([])).toEqual([]);
  });

  it("honors a custom size and rejects nonsense sizes", () => {
    expect(sliceIntoBatches([1, 2, 3], 2)).toEqual([[1, 2], [3]]);
    expect(sliceIntoBatches([1, 2, 3], 0).flat()).toEqual([1, 2, 3]);
    expect(sliceIntoBatches([1, 2, 3], Number.NaN).flat()).toEqual([1, 2, 3]);
  });

  it("stays comfortably under the legacy 100-entry server cap", () => {
    expect(SYNC_BATCH_SIZE).toBeLessThanOrEqual(100);
  });
});

describe("parseSyncResponseBody", () => {
  it("reads per-entry results from a new server", () => {
    const outcome = parseSyncResponseBody({
      acknowledgements: [{ clientId: "good-1", validations: [] }, { clientId: "good-2" }],
      accepted: ["good-1", "good-2"],
      rejected: [{ clientId: "bad-1", reason: "climb is required" }],
    });
    expect(outcome.acknowledgements.map((ack) => ack.clientId)).toEqual(["good-1", "good-2"]);
    expect(outcome.rejected).toEqual([{ clientId: "bad-1", reason: "climb is required" }]);
  });

  it("feature-detects an old server that only sends acknowledgements", () => {
    const outcome = parseSyncResponseBody({
      acknowledgements: [{ clientId: "good-1" }],
    });
    expect(outcome.acknowledgements.map((ack) => ack.clientId)).toEqual(["good-1"]);
    expect(outcome.rejected).toEqual([]);
  });

  it("never crashes on malformed bodies", () => {
    expect(parseSyncResponseBody(null)).toEqual({ acknowledgements: [], rejected: [] });
    expect(parseSyncResponseBody("nope")).toEqual({ acknowledgements: [], rejected: [] });
    expect(parseSyncResponseBody({ acknowledgements: "x", rejected: 4 })).toEqual({
      acknowledgements: [],
      rejected: [],
    });
  });

  it("drops rows without a usable clientId and fills a default reason", () => {
    const outcome = parseSyncResponseBody({
      acknowledgements: [{ clientId: "" }, { validations: [] }, { clientId: "kept" }],
      rejected: [{ clientId: "", reason: "x" }, { reason: "y" }, { clientId: "bad", reason: "  " }],
    });
    expect(outcome.acknowledgements.map((ack) => ack.clientId)).toEqual(["kept"]);
    expect(outcome.rejected).toEqual([
      { clientId: "bad", reason: "Server rejected this entry" },
    ]);
  });
});
