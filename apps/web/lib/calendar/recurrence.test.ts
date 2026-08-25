import { describe, expect, it } from "vitest";
import {
  RecurrenceError,
  describeRRule,
  draftToRRule,
  expandOccurrences,
  formatRRule,
  localDateOf,
  occurrenceId,
  parseOccurrenceId,
  parseRRule,
  previousLocalDate,
  recurrenceEndDate,
  rruleToDraft,
  safeParseRRule,
} from "./recurrence";

const NY = "America/New_York";

/** Convenience: the ISO start of every occurrence in a window. */
function starts(input: Parameters<typeof expandOccurrences>[0]): string[] {
  return expandOccurrences(input).map((occurrence) => occurrence.startsAt);
}

describe("parseRRule", () => {
  it("parses the supported subset", () => {
    const rule = parseRRule("RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,TH;COUNT=8");
    expect(rule).toEqual({
      freq: "WEEKLY",
      interval: 2,
      byDay: ["TU", "TH"],
      byDayOrdinal: null,
      count: 8,
      until: null,
    });
  });

  it("normalizes UNTIL to an instant and round-trips through formatRRule", () => {
    const rule = parseRRule("FREQ=WEEKLY;BYDAY=TU,TH;UNTIL=20260220T045959Z");
    expect(rule.until).toBe("2026-02-20T04:59:59.000Z");
    expect(formatRRule(rule)).toBe("FREQ=WEEKLY;BYDAY=TU,TH;UNTIL=20260220T045959Z");
  });

  it("treats a date-only UNTIL as inclusive of that whole day", () => {
    expect(parseRRule("FREQ=DAILY;UNTIL=20260220").until).toBe("2026-02-20T23:59:59.000Z");
  });

  it("sorts BYDAY Monday-first so storage is canonical", () => {
    expect(formatRRule(parseRRule("FREQ=WEEKLY;BYDAY=SA,TU,TH"))).toBe(
      "FREQ=WEEKLY;BYDAY=TU,TH,SA",
    );
  });

  it("accepts an ordinal BYDAY only for MONTHLY", () => {
    const rule = parseRRule("FREQ=MONTHLY;BYDAY=3TU");
    expect(rule.byDayOrdinal).toBe(3);
    expect(formatRRule(rule)).toBe("FREQ=MONTHLY;BYDAY=3TU");
    expect(() => parseRRule("FREQ=WEEKLY;BYDAY=3TU")).toThrow(/only supported with FREQ=MONTHLY/);
    expect(() => parseRRule("FREQ=MONTHLY;BYDAY=TU")).toThrow(/needs an ordinal/);
  });

  it("rejects anything outside the subset rather than silently mishandling it", () => {
    expect(() => parseRRule("FREQ=YEARLY")).toThrow(RecurrenceError);
    expect(() => parseRRule("FREQ=WEEKLY;BYSETPOS=-1")).toThrow(/not supported/);
    expect(() => parseRRule("FREQ=WEEKLY;BYMONTHDAY=3")).toThrow(/not supported/);
    expect(() => parseRRule("FREQ=WEEKLY;WKST=SU")).toThrow(/WKST=MO/);
    expect(() => parseRRule("FREQ=WEEKLY;COUNT=3;UNTIL=20260220")).toThrow(/not both/);
    expect(() => parseRRule("FREQ=WEEKLY;INTERVAL=0")).toThrow(/INTERVAL/);
    expect(() => parseRRule("FREQ=WEEKLY;INTERVAL=99")).toThrow(/INTERVAL/);
    expect(() => parseRRule("BYDAY=TU")).toThrow(/needs FREQ/);
    expect(() => parseRRule("")).toThrow(/empty/);
    expect(() => parseRRule("FREQ=WEEKLY;FREQ=DAILY")).toThrow(/more than once/);
    expect(() => parseRRule("FREQ=WEEKLY;UNTIL=20260220T045959")).toThrow(/YYYYMMDD/);
  });

  it("safeParseRRule reports the error instead of throwing", () => {
    const result = safeParseRRule("FREQ=HOURLY");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/not supported/);
  });
});

describe("expandOccurrences — DST", () => {
  it("keeps a 6pm Tuesday meeting at 6pm local across the November change", () => {
    // DST ends 2026-11-01 in the US, so the same wall clock is a different UTC instant.
    const list = starts({
      rrule: "FREQ=WEEKLY;BYDAY=TU;COUNT=3",
      start: "2026-10-27T22:00:00.000Z", // 18:00 EDT
      timeZone: NY,
      windowStart: "2026-10-01T00:00:00.000Z",
      windowEnd: "2026-12-01T00:00:00.000Z",
    });
    expect(list).toEqual([
      "2026-10-27T22:00:00.000Z", // 18:00 EDT (UTC-4)
      "2026-11-03T23:00:00.000Z", // 18:00 EST (UTC-5) — same wall clock
      "2026-11-10T23:00:00.000Z",
    ]);
  });

  it("keeps wall-clock time across the spring change too", () => {
    const list = starts({
      rrule: "FREQ=WEEKLY;BYDAY=SA;COUNT=2",
      start: "2026-03-07T15:00:00.000Z", // 10:00 EST
      timeZone: NY,
      windowStart: "2026-03-01T00:00:00.000Z",
      windowEnd: "2026-04-01T00:00:00.000Z",
    });
    expect(list).toEqual(["2026-03-07T15:00:00.000Z", "2026-03-14T14:00:00.000Z"]);
  });

  it("expands in UTC when the series has no zone", () => {
    const list = starts({
      rrule: "FREQ=WEEKLY;BYDAY=TU;COUNT=2",
      start: "2026-10-27T22:00:00.000Z",
      timeZone: "UTC",
      windowStart: "2026-10-01T00:00:00.000Z",
      windowEnd: "2026-12-01T00:00:00.000Z",
    });
    expect(list).toEqual(["2026-10-27T22:00:00.000Z", "2026-11-03T22:00:00.000Z"]);
  });
});

describe("expandOccurrences — the build-season shape", () => {
  it("expands BYDAY multi-day weeks in chronological order", () => {
    // "Tuesday and Thursday 6-9pm" starting Tue Jan 6 2026.
    const occurrences = expandOccurrences({
      rrule: "FREQ=WEEKLY;BYDAY=TU,TH",
      start: "2026-01-06T23:00:00.000Z", // 18:00 EST
      durationMs: 3 * 60 * 60 * 1000,
      timeZone: NY,
      windowStart: "2026-01-01T00:00:00.000Z",
      windowEnd: "2026-01-20T00:00:00.000Z",
    });
    expect(occurrences.map((o) => localDateOf(o.startsAt, NY))).toEqual([
      "2026-01-06",
      "2026-01-08",
      "2026-01-13",
      "2026-01-15",
    ]);
    expect(occurrences[0]!.endsAt).toBe("2026-01-07T02:00:00.000Z");
    expect(occurrences.map((o) => o.index)).toEqual([0, 1, 2, 3]);
  });

  it("never emits a BYDAY occurrence before DTSTART in the first week", () => {
    // DTSTART is the Thursday; the Tuesday of that same week must not appear.
    const list = starts({
      rrule: "FREQ=WEEKLY;BYDAY=TU,TH;COUNT=3",
      start: "2026-01-08T23:00:00.000Z",
      timeZone: NY,
      windowStart: "2026-01-01T00:00:00.000Z",
      windowEnd: "2026-02-01T00:00:00.000Z",
    });
    expect(list.map((iso) => localDateOf(iso, NY))).toEqual([
      "2026-01-08",
      "2026-01-13",
      "2026-01-15",
    ]);
  });

  it("honors INTERVAL=2 (every other week)", () => {
    const list = starts({
      rrule: "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO",
      start: "2026-01-05T18:00:00.000Z",
      timeZone: NY,
      windowStart: "2026-01-01T00:00:00.000Z",
      windowEnd: "2026-02-16T00:00:00.000Z",
    });
    expect(list.map((iso) => localDateOf(iso, NY))).toEqual([
      "2026-01-05",
      "2026-01-19",
      "2026-02-02",
    ]);
  });

  it("honors DAILY INTERVAL", () => {
    const list = starts({
      rrule: "FREQ=DAILY;INTERVAL=3;COUNT=3",
      start: "2026-01-05T18:00:00.000Z",
      timeZone: NY,
      windowStart: "2026-01-01T00:00:00.000Z",
      windowEnd: "2026-02-01T00:00:00.000Z",
    });
    expect(list.map((iso) => localDateOf(iso, NY))).toEqual([
      "2026-01-05",
      "2026-01-08",
      "2026-01-11",
    ]);
  });

  it("expands MONTHLY on the same day of month and skips short months", () => {
    const list = starts({
      rrule: "FREQ=MONTHLY;COUNT=4",
      start: "2026-01-31T18:00:00.000Z",
      timeZone: NY,
      windowStart: "2026-01-01T00:00:00.000Z",
      windowEnd: "2026-07-01T00:00:00.000Z",
    });
    // February, April and June have no 31st — RFC 5545 skips them, never clamps.
    expect(list.map((iso) => localDateOf(iso, NY))).toEqual([
      "2026-01-31",
      "2026-03-31",
      "2026-05-31",
    ]);
  });

  it("expands MONTHLY on an ordinal weekday", () => {
    const list = starts({
      rrule: "FREQ=MONTHLY;BYDAY=3TU;COUNT=3",
      start: "2026-01-20T18:00:00.000Z", // third Tuesday of January 2026
      timeZone: NY,
      windowStart: "2026-01-01T00:00:00.000Z",
      windowEnd: "2026-06-01T00:00:00.000Z",
    });
    expect(list.map((iso) => localDateOf(iso, NY))).toEqual([
      "2026-01-20",
      "2026-02-17",
      "2026-03-17",
    ]);
  });
});

describe("expandOccurrences — bounds", () => {
  it("stops after COUNT occurrences", () => {
    const list = starts({
      rrule: "FREQ=WEEKLY;BYDAY=TU,TH;COUNT=5",
      start: "2026-01-06T23:00:00.000Z",
      timeZone: NY,
      windowStart: "2026-01-01T00:00:00.000Z",
      windowEnd: "2027-01-01T00:00:00.000Z",
    });
    expect(list).toHaveLength(5);
  });

  it("counts skipped occurrences against COUNT (RFC 5545 semantics)", () => {
    const list = starts({
      rrule: "FREQ=WEEKLY;BYDAY=TU;COUNT=3",
      start: "2026-01-06T23:00:00.000Z",
      timeZone: NY,
      windowStart: "2026-01-01T00:00:00.000Z",
      windowEnd: "2027-01-01T00:00:00.000Z",
      exceptions: [{ occurrenceDate: "2026-01-13T23:00:00.000Z", action: "skipped" }],
    });
    expect(list.map((iso) => localDateOf(iso, NY))).toEqual(["2026-01-06", "2026-01-20"]);
  });

  it("stops at UNTIL, inclusive of that instant", () => {
    const list = starts({
      rrule: "FREQ=WEEKLY;BYDAY=TU;UNTIL=20260120T235959Z",
      start: "2026-01-06T23:00:00.000Z",
      timeZone: NY,
      windowStart: "2026-01-01T00:00:00.000Z",
      windowEnd: "2027-01-01T00:00:00.000Z",
    });
    expect(list.map((iso) => localDateOf(iso, NY))).toEqual([
      "2026-01-06",
      "2026-01-13",
      "2026-01-20",
    ]);
  });

  it("also clamps at the denormalized recurrence_end date", () => {
    const list = starts({
      rrule: "FREQ=WEEKLY;BYDAY=TU",
      start: "2026-01-06T23:00:00.000Z",
      timeZone: NY,
      windowStart: "2026-01-01T00:00:00.000Z",
      windowEnd: "2027-01-01T00:00:00.000Z",
      recurrenceEnd: "2026-01-14",
    });
    expect(list.map((iso) => localDateOf(iso, NY))).toEqual(["2026-01-06", "2026-01-13"]);
  });

  it("returns nothing when the series has no occurrence in the window", () => {
    expect(
      starts({
        rrule: "FREQ=WEEKLY;BYDAY=TU;COUNT=4",
        start: "2026-01-06T23:00:00.000Z",
        timeZone: NY,
        windowStart: "2026-06-01T00:00:00.000Z",
        windowEnd: "2026-07-01T00:00:00.000Z",
      }),
    ).toEqual([]);
  });

  it("returns nothing when the window ends before the series starts", () => {
    expect(
      starts({
        rrule: "FREQ=WEEKLY;BYDAY=TU",
        start: "2026-06-02T22:00:00.000Z",
        timeZone: NY,
        windowStart: "2026-01-01T00:00:00.000Z",
        windowEnd: "2026-02-01T00:00:00.000Z",
      }),
    ).toEqual([]);
  });

  it("clamps an unbounded series to the window instead of generating forever", () => {
    const list = starts({
      rrule: "FREQ=DAILY",
      start: "2020-01-01T18:00:00.000Z",
      timeZone: NY,
      windowStart: "2026-01-01T00:00:00.000Z",
      windowEnd: "2026-01-11T00:00:00.000Z",
    });
    expect(list).toHaveLength(10);
    expect(localDateOf(list[0]!, NY)).toBe("2026-01-01");
    expect(localDateOf(list[9]!, NY)).toBe("2026-01-10");
  });

  it("never exceeds maxOccurrences", () => {
    const list = starts({
      rrule: "FREQ=DAILY",
      start: "2026-01-01T18:00:00.000Z",
      timeZone: NY,
      windowStart: "2026-01-01T00:00:00.000Z",
      windowEnd: "2030-01-01T00:00:00.000Z",
      maxOccurrences: 25,
    });
    expect(list).toHaveLength(25);
  });

  it("returns an empty list for an inverted window", () => {
    expect(
      starts({
        rrule: "FREQ=DAILY",
        start: "2026-01-01T18:00:00.000Z",
        timeZone: NY,
        windowStart: "2026-02-01T00:00:00.000Z",
        windowEnd: "2026-01-01T00:00:00.000Z",
      }),
    ).toEqual([]);
  });
});

describe("expandOccurrences — exceptions", () => {
  const base = {
    rrule: "FREQ=WEEKLY;BYDAY=TU;COUNT=6",
    start: "2026-11-03T23:00:00.000Z",
    timeZone: NY,
    windowStart: "2026-11-01T00:00:00.000Z",
    windowEnd: "2026-12-20T00:00:00.000Z",
  } as const;

  it("drops a skipped week (no meeting the week of Thanksgiving)", () => {
    const list = starts({
      ...base,
      exceptions: [{ occurrenceDate: "2026-11-24T23:00:00.000Z", action: "skipped" }],
    });
    expect(list.map((iso) => localDateOf(iso, NY))).toEqual([
      "2026-11-03",
      "2026-11-10",
      "2026-11-17",
      "2026-12-01",
      "2026-12-08",
    ]);
  });

  it("drops a moved occurrence so the detached row can supply the new time", () => {
    const list = starts({
      ...base,
      exceptions: [{ occurrenceDate: "2026-11-10T23:00:00.000Z", action: "moved" }],
    });
    expect(list.map((iso) => localDateOf(iso, NY))).not.toContain("2026-11-10");
    expect(list).toHaveLength(5);
  });

  it("drops an edited occurrence the same way", () => {
    const list = starts({
      ...base,
      exceptions: [{ occurrenceDate: "2026-11-17T23:00:00.000Z", action: "edited" }],
    });
    expect(list.map((iso) => localDateOf(iso, NY))).not.toContain("2026-11-17");
  });

  it("ignores exceptions that do not line up with an occurrence", () => {
    const list = starts({
      ...base,
      exceptions: [{ occurrenceDate: "2026-11-11T23:00:00.000Z", action: "skipped" }],
    });
    expect(list).toHaveLength(6);
  });
});

describe("describeRRule", () => {
  it("reads back as plain English", () => {
    expect(
      describeRRule("FREQ=WEEKLY;BYDAY=TU,TH;UNTIL=20260220T235959Z", { timeZone: "UTC" }),
    ).toBe("Every Tuesday and Thursday until Feb 20");
    expect(describeRRule("FREQ=WEEKLY;INTERVAL=2;BYDAY=MO")).toBe("Every 2 weeks on Monday");
    expect(describeRRule("FREQ=DAILY;COUNT=5")).toBe("Every day, 5 times");
    expect(describeRRule("FREQ=DAILY;INTERVAL=2")).toBe("Every 2 days");
    expect(describeRRule("FREQ=MONTHLY;BYDAY=-1FR")).toBe("Monthly on the last Friday");
    expect(describeRRule("FREQ=WEEKLY;BYDAY=MO,WE,FR")).toBe(
      "Every Monday, Wednesday, and Friday",
    );
  });

  it("falls back to the start date's weekday when BYDAY is absent", () => {
    expect(describeRRule("FREQ=WEEKLY", { start: "2026-01-06T23:00:00.000Z", timeZone: NY })).toBe(
      "Every Tuesday",
    );
  });

  it("surfaces the parse error instead of a wrong summary", () => {
    expect(describeRRule("FREQ=YEARLY")).toMatch(/not supported/);
  });
});

describe("repeat control drafts", () => {
  it("builds an RRULE from the form state", () => {
    expect(
      draftToRRule(
        { preset: "weekly", days: ["TU", "TH"], endMode: "on", endsOn: "2026-02-20", count: 10 },
        { start: "2026-01-06T23:00:00.000Z", timeZone: NY },
      ),
    ).toBe("FREQ=WEEKLY;BYDAY=TU,TH;UNTIL=20260221T045959Z");

    expect(
      draftToRRule(
        { preset: "biweekly", days: [], endMode: "after", endsOn: "", count: 6 },
        { start: "2026-01-06T23:00:00.000Z", timeZone: NY },
      ),
    ).toBe("FREQ=WEEKLY;INTERVAL=2;BYDAY=TU;COUNT=6");

    expect(
      draftToRRule(
        { preset: "none", days: [], endMode: "never", endsOn: "", count: 10 },
        { start: "2026-01-06T23:00:00.000Z", timeZone: NY },
      ),
    ).toBeNull();
  });

  it("refuses an end date before the start", () => {
    expect(() =>
      draftToRRule(
        { preset: "weekly", days: ["TU"], endMode: "on", endsOn: "2025-01-01", count: 10 },
        { start: "2026-01-06T23:00:00.000Z", timeZone: NY },
      ),
    ).toThrow(/before the start/);
  });

  it("round-trips back into the form state", () => {
    const draft = rruleToDraft("FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,TH;UNTIL=20260221T045959Z", {
      timeZone: NY,
    });
    expect(draft).toEqual({
      preset: "biweekly",
      days: ["TU", "TH"],
      endMode: "on",
      endsOn: "2026-02-20",
      count: 10,
    });
  });

  it("derives the recurrence_end column value", () => {
    expect(recurrenceEndDate("FREQ=WEEKLY;BYDAY=TU;UNTIL=20260221T045959Z", { timeZone: NY })).toBe(
      "2026-02-20",
    );
    expect(recurrenceEndDate("FREQ=WEEKLY;BYDAY=TU;COUNT=4")).toBeNull();
    expect(recurrenceEndDate(null)).toBeNull();
  });
});

describe("occurrence ids", () => {
  const master = "11111111-2222-3333-4444-555555555555";

  it("round-trips", () => {
    const id = occurrenceId(master, "2026-11-10T23:00:00.000Z");
    expect(parseOccurrenceId(id)).toEqual({
      masterId: master,
      occurrenceDate: "2026-11-10T23:00:00.000Z",
    });
  });

  it("rejects plain uuids and junk", () => {
    expect(parseOccurrenceId(master)).toBeNull();
    expect(parseOccurrenceId(`${master}#not-a-date`)).toBeNull();
    expect(parseOccurrenceId("not-a-uuid#2026-11-10T23:00:00.000Z")).toBeNull();
  });
});

describe("local date helpers", () => {
  it("uses the series zone, not the server zone", () => {
    // 2026-11-11T02:30Z is still Nov 10 in New York.
    expect(localDateOf("2026-11-11T02:30:00.000Z", NY)).toBe("2026-11-10");
    expect(localDateOf("2026-11-11T02:30:00.000Z", "UTC")).toBe("2026-11-11");
  });

  it("finds the previous local day for a 'this and following' cutoff", () => {
    expect(previousLocalDate("2026-11-10T23:00:00.000Z", NY)).toBe("2026-11-09");
    expect(previousLocalDate("2026-01-01T18:00:00.000Z", NY)).toBe("2025-12-31");
  });
});
