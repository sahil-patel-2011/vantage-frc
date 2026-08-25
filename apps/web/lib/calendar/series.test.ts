import { describe, expect, it } from "vitest";
import {
  expandSeriesRow,
  expandSeriesRows,
  isDetachedOccurrence,
  isSeriesMaster,
  parseOccurrenceRef,
  parseRepeatInput,
  parseOccurrenceScope,
  splitSeriesRule,
  type SeriesRow,
  type StoredException,
} from "./series";

const NY = "America/New_York";
const MASTER = "11111111-1111-4111-8111-111111111111";
const DETACHED = "22222222-2222-4222-8222-222222222222";

/** Tue 2026-01-13 18:00–21:00 America/New_York. */
function master(overrides: Partial<SeriesRow> = {}): SeriesRow {
  return {
    id: MASTER,
    startsAt: "2026-01-13T23:00:00.000Z",
    endsAt: "2026-01-14T02:00:00.000Z",
    rrule: "FREQ=WEEKLY;BYDAY=TU,TH",
    recurrenceEnd: null,
    seriesId: MASTER,
    recurrenceTimezone: NY,
    ...overrides,
  };
}

const WINDOW = {
  windowStart: "2026-01-01T00:00:00.000Z",
  windowEnd: "2026-03-01T00:00:00.000Z",
};

describe("row classification", () => {
  it("separates masters from detached overrides", () => {
    expect(isSeriesMaster(master())).toBe(true);
    const detached = master({ id: DETACHED, rrule: null, seriesId: MASTER });
    expect(isSeriesMaster(detached)).toBe(false);
    expect(isDetachedOccurrence(detached)).toBe(true);
    const oneOff = master({ id: DETACHED, rrule: null, seriesId: null });
    expect(isDetachedOccurrence(oneOff)).toBe(false);
  });
});

describe("expandSeriesRow", () => {
  it("expands a Tuesday/Thursday build season inside the window", () => {
    const out = expandSeriesRow(master(), [], WINDOW);
    // Jan 13 through Feb 26 inclusive: 7 weeks of Tue+Thu, minus the Thursdays
    // before DTSTART. First is DTSTART itself.
    expect(out[0]!.startsAt).toBe("2026-01-13T23:00:00.000Z");
    expect(out[0]!.id).toBe(MASTER);
    expect(out[0]!.virtual).toBe(false);
    expect(out[1]!.startsAt).toBe("2026-01-15T23:00:00.000Z");
    expect(out[1]!.id).toBe(`${MASTER}#2026-01-15T23:00:00.000Z`);
    expect(out[1]!.virtual).toBe(true);
    expect(out.every((occurrence) => occurrence.masterId === MASTER)).toBe(true);
  });

  it("carries the series duration onto every occurrence", () => {
    const out = expandSeriesRow(master(), [], WINDOW);
    for (const occurrence of out) {
      const span =
        new Date(occurrence.endsAt!).getTime() - new Date(occurrence.startsAt).getTime();
      expect(span).toBe(3 * 3600_000);
    }
  });

  it("holds 6pm local across the November DST change", () => {
    const out = expandSeriesRow(
      master({
        startsAt: "2026-10-13T22:00:00.000Z", // Tue Oct 13, 6pm EDT
        endsAt: "2026-10-14T01:00:00.000Z",
        rrule: "FREQ=WEEKLY;BYDAY=TU",
      }),
      [],
      { windowStart: "2026-10-01T00:00:00.000Z", windowEnd: "2026-12-01T00:00:00.000Z" },
    );
    const localHours = out.map((occurrence) =>
      new Intl.DateTimeFormat("en-US", { timeZone: NY, hour: "2-digit", hourCycle: "h23" }).format(
        new Date(occurrence.startsAt),
      ),
    );
    expect(new Set(localHours)).toEqual(new Set(["18"]));
    // The instant really does shift by an hour after Nov 1.
    expect(out.some((occurrence) => occurrence.startsAt.endsWith("T22:00:00.000Z"))).toBe(true);
    expect(out.some((occurrence) => occurrence.startsAt.endsWith("T23:00:00.000Z"))).toBe(true);
  });

  it("drops skipped and detached occurrences", () => {
    const exceptions: StoredException[] = [
      {
        seriesId: MASTER,
        occurrenceDate: "2026-01-20T23:00:00.000Z",
        action: "skipped",
        detachedEventId: null,
      },
      {
        seriesId: MASTER,
        occurrenceDate: "2026-01-22T23:00:00.000Z",
        action: "moved",
        detachedEventId: DETACHED,
      },
    ];
    const starts = expandSeriesRow(master(), exceptions, WINDOW).map((o) => o.startsAt);
    expect(starts).not.toContain("2026-01-20T23:00:00.000Z");
    expect(starts).not.toContain("2026-01-22T23:00:00.000Z");
    expect(starts).toContain("2026-01-27T23:00:00.000Z");
  });

  it("returns nothing when the series ended before the window", () => {
    const out = expandSeriesRow(
      master({ rrule: "FREQ=WEEKLY;BYDAY=TU;COUNT=2" }),
      [],
      { windowStart: "2026-06-01T00:00:00.000Z", windowEnd: "2026-07-01T00:00:00.000Z" },
    );
    expect(out).toEqual([]);
  });

  it("clamps an unbounded series to the window", () => {
    const out = expandSeriesRow(master({ rrule: "FREQ=DAILY" }), [], {
      windowStart: "2026-01-13T00:00:00.000Z",
      windowEnd: "2026-01-23T00:00:00.000Z",
    });
    expect(out).toHaveLength(10);
  });

  it("falls back to the single start when the stored rule is unreadable", () => {
    const out = expandSeriesRow(master({ rrule: "FREQ=HOURLY;BYSETPOS=2" }), [], WINDOW);
    expect(out).toHaveLength(1);
    expect(out[0]!.id).toBe(MASTER);
    expect(out[0]!.virtual).toBe(false);
  });

  it("ignores rows that are not masters", () => {
    expect(expandSeriesRow(master({ rrule: null }), [], WINDOW)).toEqual([]);
  });
});

describe("expandSeriesRows", () => {
  it("routes exceptions to the right series", () => {
    const other = "33333333-3333-4333-8333-333333333333";
    const rows = [
      master(),
      master({ id: other, seriesId: other, rrule: "FREQ=WEEKLY;BYDAY=TU" }),
      master({ id: DETACHED, rrule: null, seriesId: MASTER }),
    ];
    const exceptions: StoredException[] = [
      {
        seriesId: other,
        occurrenceDate: "2026-01-20T23:00:00.000Z",
        action: "skipped",
        detachedEventId: null,
      },
    ];
    const out = expandSeriesRows(rows, exceptions, WINDOW);
    expect(out.has(DETACHED)).toBe(false);
    expect(out.get(MASTER)!.map((o) => o.startsAt)).toContain("2026-01-20T23:00:00.000Z");
    expect(out.get(other)!.map((o) => o.startsAt)).not.toContain("2026-01-20T23:00:00.000Z");
  });
});

describe("splitSeriesRule", () => {
  it("gives an unbounded rule a head UNTIL just before the split", () => {
    const split = splitSeriesRule({
      rrule: "FREQ=WEEKLY;BYDAY=TU,TH",
      start: "2026-01-13T23:00:00.000Z",
      splitStart: "2026-01-27T23:00:00.000Z",
      timeZone: NY,
    });
    expect(split.head!.rrule).toBe("FREQ=WEEKLY;BYDAY=TU,TH;UNTIL=20260127T225959Z");
    expect(split.head!.recurrenceEnd).toBe("2026-01-27");
    expect(split.tail.rrule).toBe("FREQ=WEEKLY;BYDAY=TU,TH");
    expect(split.tail.recurrenceEnd).toBeNull();
  });

  it("hands the original UNTIL to the tail", () => {
    const split = splitSeriesRule({
      rrule: "FREQ=WEEKLY;BYDAY=TU;UNTIL=20260331T035959Z",
      start: "2026-01-13T23:00:00.000Z",
      splitStart: "2026-02-03T23:00:00.000Z",
      timeZone: NY,
    });
    expect(split.tail.rrule).toContain("UNTIL=20260331T035959Z");
    expect(split.tail.recurrenceEnd).toBe("2026-03-30");
    expect(split.head!.rrule).toContain("UNTIL=20260203T225959Z");
  });

  it("divides a COUNT rule so the total is preserved", () => {
    const split = splitSeriesRule({
      rrule: "FREQ=WEEKLY;BYDAY=TU;COUNT=10",
      start: "2026-01-13T23:00:00.000Z",
      // Fourth occurrence: Jan 13, 20, 27, Feb 3.
      splitStart: "2026-02-03T23:00:00.000Z",
      timeZone: NY,
    });
    expect(split.head!.rrule).toBe("FREQ=WEEKLY;BYDAY=TU;COUNT=3");
    expect(split.tail.rrule).toBe("FREQ=WEEKLY;BYDAY=TU;COUNT=7");
  });

  it("treats a split at the first occurrence as editing the whole series", () => {
    const split = splitSeriesRule({
      rrule: "FREQ=WEEKLY;BYDAY=TU",
      start: "2026-01-13T23:00:00.000Z",
      splitStart: "2026-01-13T23:00:00.000Z",
      timeZone: NY,
    });
    expect(split.head).toBeNull();
    expect(split.tail.rrule).toBe("FREQ=WEEKLY;BYDAY=TU");
  });

  it("rejects a rule it cannot represent rather than splitting it wrong", () => {
    expect(() =>
      splitSeriesRule({
        rrule: "FREQ=YEARLY",
        start: "2026-01-13T23:00:00.000Z",
        splitStart: "2026-02-03T23:00:00.000Z",
        timeZone: NY,
      }),
    ).toThrow(/DAILY, WEEKLY, or MONTHLY/);
  });
});

describe("parseRepeatInput", () => {
  it("returns no rule for 'does not repeat'", () => {
    expect(parseRepeatInput({})).toEqual({ rrule: null, timeZone: "UTC", recurrenceEnd: null });
    expect(parseRepeatInput({ rrule: "", timeZone: NY }).rrule).toBeNull();
  });

  it("canonicalizes a supported rule and derives the end date", () => {
    const parsed = parseRepeatInput({
      rrule: "RRULE:freq=weekly;byday=th,tu;interval=1;until=20260220T045959Z",
      timeZone: NY,
    });
    expect(parsed.rrule).toBe("FREQ=WEEKLY;BYDAY=TU,TH;UNTIL=20260220T045959Z");
    expect(parsed.timeZone).toBe(NY);
    expect(parsed.recurrenceEnd).toBe("2026-02-19");
  });

  it("rejects an unsupported rule with a readable message", () => {
    expect(() => parseRepeatInput({ rrule: "FREQ=WEEKLY;BYSETPOS=2" })).toThrow(/not supported/);
    expect(() => parseRepeatInput({ rrule: 42 })).toThrow(/must be text/);
  });

  it("falls back to UTC for a junk timezone instead of throwing", () => {
    expect(parseRepeatInput({ rrule: "FREQ=DAILY", timeZone: "Mars/Olympus" }).timeZone).toBe("UTC");
  });
});

describe("parseOccurrenceRef / parseOccurrenceScope", () => {
  it("accepts a plain row id", () => {
    expect(parseOccurrenceRef(MASTER)).toEqual({ rowId: MASTER, occurrenceStart: null });
  });

  it("accepts a composite virtual occurrence id", () => {
    expect(parseOccurrenceRef(`${MASTER}#2026-01-20T23:00:00.000Z`)).toEqual({
      rowId: MASTER,
      occurrenceStart: "2026-01-20T23:00:00.000Z",
    });
  });

  it("rejects junk", () => {
    expect(() => parseOccurrenceRef("")).toThrow(/required/);
    expect(() => parseOccurrenceRef("not-an-id#nope")).toThrow(/not valid/);
    expect(() => parseOccurrenceRef(`${MASTER}#not-a-date`)).toThrow(/not valid/);
  });

  it("defaults an unknown scope to just this occurrence", () => {
    expect(parseOccurrenceScope("all")).toBe("all");
    expect(parseOccurrenceScope("following")).toBe("following");
    expect(parseOccurrenceScope("nonsense")).toBe("this");
    expect(parseOccurrenceScope(undefined)).toBe("this");
  });
});
