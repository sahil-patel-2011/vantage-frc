import { describe, expect, it } from "vitest";
import { earliestCursor, prependEarlier, trimHistoryPage } from "./history";

const msg = (id: string, createdAt: string, extra: Record<string, unknown> = {}) => ({
  id,
  createdAt,
  ...extra,
});

describe("trimHistoryPage", () => {
  it("reverses a newest-first page into display (ascending) order", () => {
    const rows = [
      msg("c", "2026-08-23T12:02:00.000Z"),
      msg("b", "2026-08-23T12:01:00.000Z"),
      msg("a", "2026-08-23T12:00:00.000Z"),
    ];
    const { messages, hasEarlier } = trimHistoryPage(rows, 3);
    expect(messages.map((m) => m.id)).toEqual(["a", "b", "c"]);
    expect(hasEarlier).toBe(false);
  });

  it("keeps the NEWEST pageSize rows and flags earlier history via the sentinel row", () => {
    // Fetched with LIMIT pageSize+1: the extra (oldest) row proves more exists.
    const rows = [
      msg("d", "2026-08-23T12:03:00.000Z"),
      msg("c", "2026-08-23T12:02:00.000Z"),
      msg("b", "2026-08-23T12:01:00.000Z"),
      msg("a", "2025-09-01T00:00:00.000Z"), // sentinel from last September — must be dropped
    ];
    const { messages, hasEarlier } = trimHistoryPage(rows, 3);
    expect(messages.map((m) => m.id)).toEqual(["b", "c", "d"]);
    expect(hasEarlier).toBe(true);
  });

  it("does not mutate the input rows", () => {
    const rows = [msg("b", "2026-08-23T12:01:00.000Z"), msg("a", "2026-08-23T12:00:00.000Z")];
    trimHistoryPage(rows, 5);
    expect(rows.map((m) => m.id)).toEqual(["b", "a"]);
  });

  it("handles an empty conversation", () => {
    expect(trimHistoryPage([], 100)).toEqual({ messages: [], hasEarlier: false });
  });
});

describe("earliestCursor", () => {
  it("returns null when nothing is loaded", () => {
    expect(earliestCursor([])).toBeNull();
  });

  it("points at the oldest loaded message", () => {
    const cursor = earliestCursor([
      msg("b", "2026-08-23T12:01:00.000Z"),
      msg("a", "2026-08-23T12:00:00.000Z"),
      msg("c", "2026-08-23T12:02:00.000Z"),
    ]);
    expect(cursor).toEqual({ before: "2026-08-23T12:00:00.000Z", beforeId: "a" });
  });

  it("breaks created_at ties by id so the keyset cursor is deterministic", () => {
    const cursor = earliestCursor([
      msg("bbb", "2026-08-23T12:00:00.000Z"),
      msg("aaa", "2026-08-23T12:00:00.000Z"),
    ]);
    expect(cursor).toEqual({ before: "2026-08-23T12:00:00.000Z", beforeId: "aaa" });
  });
});

describe("prependEarlier", () => {
  it("prepends an older page in ascending order", () => {
    const existing = [msg("c", "2026-08-23T12:02:00.000Z"), msg("d", "2026-08-23T12:03:00.000Z")];
    const earlier = [msg("a", "2026-08-23T12:00:00.000Z"), msg("b", "2026-08-23T12:01:00.000Z")];
    expect(prependEarlier(existing, earlier).map((m) => m.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("keeps the already-loaded copy when ids overlap (fresher edit/delete state)", () => {
    const existing = [msg("b", "2026-08-23T12:01:00.000Z", { deletedAt: "2026-08-23T12:05:00.000Z" })];
    const earlier = [
      msg("a", "2026-08-23T12:00:00.000Z"),
      msg("b", "2026-08-23T12:01:00.000Z", { deletedAt: null }),
    ];
    const merged = prependEarlier(existing, earlier);
    expect(merged.map((m) => m.id)).toEqual(["a", "b"]);
    expect((merged[1] as { deletedAt?: string | null }).deletedAt).toBe("2026-08-23T12:05:00.000Z");
  });

  it("returns existing untouched when the earlier page is empty", () => {
    const existing = [msg("a", "2026-08-23T12:00:00.000Z")];
    expect(prependEarlier(existing, [])).toBe(existing);
  });
});
