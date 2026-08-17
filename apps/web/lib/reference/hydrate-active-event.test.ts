import { describe, expect, it } from "vitest";
import { eventReferenceIsFresh, isTbaEventKey } from "@vantage/reference";

describe("event reference freshness", () => {
  const now = new Date("2026-03-06T12:00:00.000Z");

  it("requires both TBA matches and Statbotics EPA in Neon", () => {
    expect(
      eventReferenceIsFresh({
        matchCount: 12,
        matchSyncedAt: "2026-03-06T11:59:00.000Z",
        epaCount: 0,
        epaSyncedAt: null,
        now,
      }),
    ).toBe(false);
    expect(
      eventReferenceIsFresh({
        matchCount: 0,
        matchSyncedAt: null,
        epaCount: 40,
        epaSyncedAt: "2026-03-06T11:59:00.000Z",
        now,
      }),
    ).toBe(false);
  });

  it("uses Neon when both sources were stored recently", () => {
    expect(
      eventReferenceIsFresh({
        matchCount: 12,
        matchSyncedAt: "2026-03-06T11:59:00.000Z",
        epaCount: 40,
        epaSyncedAt: "2026-03-06T11:50:00.000Z",
        now,
      }),
    ).toBe(true);
  });

  it("refetches when stored rows aged out", () => {
    expect(
      eventReferenceIsFresh({
        matchCount: 12,
        matchSyncedAt: "2026-03-06T11:00:00.000Z",
        epaCount: 40,
        epaSyncedAt: "2026-03-06T11:50:00.000Z",
        now,
      }),
    ).toBe(false);
  });

  it("accepts TBA event keys only", () => {
    expect(isTbaEventKey("2026miket")).toBe(true);
    expect(isTbaEventKey("not-an-event")).toBe(false);
  });
});
