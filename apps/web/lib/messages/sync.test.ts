import { describe, expect, it } from "vitest";
import {
  clampWaitMs,
  mergeMessages,
  nextWatermark,
  pollBackoffMs,
  pollGapMs,
  totalUnread,
  LONG_POLL_MAX_MS,
} from "./sync";

describe("messages sync helpers", () => {
  it("clamps long-poll wait under serverless max", () => {
    expect(clampWaitMs(null)).toBe(0);
    expect(clampWaitMs("abc")).toBe(0);
    expect(clampWaitMs("3000")).toBe(3000);
    expect(clampWaitMs("99999")).toBe(LONG_POLL_MAX_MS);
  });

  it("waits out a poll that returned before the server could have been waiting", () => {
    expect(pollGapMs(40, LONG_POLL_MAX_MS, false)).toBe(1460);
    expect(pollGapMs(40, LONG_POLL_MAX_MS, true)).toBe(1460);
    expect(pollGapMs(400, LONG_POLL_MAX_MS, true)).toBe(0);
    expect(pollGapMs(LONG_POLL_MAX_MS, LONG_POLL_MAX_MS, false)).toBe(0);
    expect(pollGapMs(10, 0, false)).toBe(1490);
  });

  it("backs off failures without exceeding the ceiling", () => {
    expect(pollBackoffMs(0)).toBe(2000);
    expect(pollBackoffMs(1)).toBe(4000);
    expect(pollBackoffMs(10)).toBe(30000);
  });

  it("merges soft-deletes and pins by id", () => {
    const previous = [
      { id: "a", createdAt: "2026-01-01T00:00:00.000Z", deletedAt: null, pinnedAt: null },
      { id: "b", createdAt: "2026-01-01T00:01:00.000Z", deletedAt: null, pinnedAt: null },
    ];
    const incoming = [
      { id: "b", createdAt: "2026-01-01T00:01:00.000Z", deletedAt: "2026-01-01T00:02:00.000Z", pinnedAt: null },
      { id: "c", createdAt: "2026-01-01T00:03:00.000Z", deletedAt: null, pinnedAt: "2026-01-01T00:03:30.000Z" },
    ];
    expect(mergeMessages(previous, incoming)).toEqual([
      previous[0],
      incoming[0],
      incoming[1],
    ]);
  });

  it("advances watermark across create, delete, and pin times", () => {
    expect(
      nextWatermark(
        [
          {
            id: "1",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
          {
            id: "2",
            createdAt: "2026-01-01T00:01:00.000Z",
            updatedAt: "2026-01-01T00:05:00.000Z",
            deletedAt: "2026-01-01T00:05:00.000Z",
          },
        ],
        "2026-01-01T00:00:30.000Z",
      ),
    ).toBe("2026-01-01T00:05:00.000Z");
  });

  it("sums unread badges across the inbox", () => {
    expect(totalUnread([{ unreadCount: 2 }, { unreadCount: 0 }, { unreadCount: 3 }])).toBe(5);
  });
});
