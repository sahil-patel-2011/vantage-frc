import { describe, expect, it } from "vitest";
import {
  activeOrgIds,
  aiDailySeries,
  aiTotalsByGroup,
  daysActiveByOrg,
  daysActiveHistogram,
  dayBefore,
  fillDailySeries,
  formatCount,
  formatUsd,
  keySourceGroup,
  lastActiveByOrg,
  safeCount,
  safeMoney,
  sumEventsByDay,
  sumEventsBySource,
  topSourceByOrg,
  utcDay,
  type ActivityRow,
} from "./compute";

const row = (orgId: string, day: string, source: string, events: number): ActivityRow => ({
  orgId,
  day,
  source,
  events,
});

describe("day axis helpers", () => {
  it("computes UTC days and offsets across month boundaries", () => {
    expect(utcDay(new Date("2026-08-24T23:59:59.000Z"))).toBe("2026-08-24");
    expect(dayBefore("2026-08-24", 0)).toBe("2026-08-24");
    expect(dayBefore("2026-03-01", 1)).toBe("2026-02-28");
    expect(dayBefore("2026-08-24", 59)).toBe("2026-06-26");
  });

  it("fills a dense series with real zeros — no fabricated activity", () => {
    const series = fillDailySeries([{ day: "2026-08-23", value: 4 }], "2026-08-24", 3);
    expect(series).toEqual([
      { day: "2026-08-22", value: 0 },
      { day: "2026-08-23", value: 4 },
      { day: "2026-08-24", value: 0 },
    ]);
  });

  it("keeps a fully empty platform at honest zeros", () => {
    const series = fillDailySeries([], "2026-08-24", 2);
    expect(series.every((point) => point.value === 0)).toBe(true);
  });
});

describe("activity aggregation", () => {
  const rows = [
    row("org-a", "2026-08-20", "messages", 5),
    row("org-a", "2026-08-20", "scouting", 2),
    row("org-a", "2026-08-22", "messages", 1),
    row("org-b", "2026-08-01", "hours", 3),
  ];

  it("sums events per day across orgs and sources", () => {
    const byDay = new Map(sumEventsByDay(rows).map((r) => [r.day, r.value]));
    expect(byDay.get("2026-08-20")).toBe(7);
    expect(byDay.get("2026-08-22")).toBe(1);
    expect(byDay.get("2026-08-01")).toBe(3);
  });

  it("ranks sources by volume", () => {
    expect(sumEventsBySource(rows)[0]).toEqual({ source: "messages", events: 6 });
  });

  it("computes active orgs from a window boundary", () => {
    expect(activeOrgIds(rows, "2026-08-20")).toEqual(new Set(["org-a"]));
    expect(activeOrgIds(rows, "2026-08-01").size).toBe(2);
  });

  it("counts distinct active days and last-active per org", () => {
    expect(daysActiveByOrg(rows).get("org-a")).toBe(2);
    expect(daysActiveByOrg(rows).get("org-b")).toBe(1);
    expect(lastActiveByOrg(rows).get("org-a")).toBe("2026-08-22");
  });

  it("finds the top source per org", () => {
    expect(topSourceByOrg(rows).get("org-a")).toBe("messages");
    expect(topSourceByOrg(rows).get("org-b")).toBe("hours");
  });

  it("ignores zero-event rows for activity flags", () => {
    const zeros = [row("org-z", "2026-08-20", "messages", 0)];
    expect(activeOrgIds(zeros, "2026-08-01").size).toBe(0);
    expect(lastActiveByOrg(zeros).size).toBe(0);
  });
});

describe("daysActiveHistogram", () => {
  it("buckets orgs and keeps idle provisioned orgs in the zero bucket", () => {
    const histogram = daysActiveHistogram([1, 2, 5, 40], 6);
    const byLabel = new Map(histogram.map((bucket) => [bucket.label, bucket.orgs]));
    expect(byLabel.get("0 days")).toBe(2);
    expect(byLabel.get("1–2 days")).toBe(2);
    expect(byLabel.get("3–7 days")).toBe(1);
    expect(byLabel.get("31+ days")).toBe(1);
  });

  it("reports honest zeros for an empty platform", () => {
    expect(daysActiveHistogram([], 0).every((bucket) => bucket.orgs === 0)).toBe(true);
  });
});

describe("AI usage shaping", () => {
  it("maps every key_source enum value onto the hosted / BYOK / local split", () => {
    expect(keySourceGroup("platform")).toBe("hosted");
    expect(keySourceGroup("sponsored")).toBe("hosted");
    expect(keySourceGroup("byo")).toBe("byok");
    expect(keySourceGroup("local")).toBe("local");
    expect(keySourceGroup("local_cli")).toBe("local");
    expect(keySourceGroup("mystery")).toBe("other");
  });

  it("collapses key sources into ordered group totals", () => {
    const groups = aiTotalsByGroup([
      { day: "2026-08-24", keySource: "byo", calls: 2, tokens: 100, costUsd: 0.5 },
      { day: "2026-08-24", keySource: "platform", calls: 1, tokens: 50, costUsd: 0.25 },
      { day: "2026-08-23", keySource: "sponsored", calls: 3, tokens: 30, costUsd: 0.1 },
    ]);
    expect(groups.map((g) => g.group)).toEqual(["hosted", "byok"]);
    expect(groups[0]).toMatchObject({ calls: 4, tokens: 80, costUsd: 0.35 });
  });

  it("builds a dense per-day AI series", () => {
    const series = aiDailySeries(
      [
        { day: "2026-08-24", keySource: "byo", calls: 2, tokens: 100, costUsd: 0.5 },
        { day: "2026-08-24", keySource: "platform", calls: 1, tokens: 10, costUsd: 0.1 },
      ],
      "2026-08-24",
      2,
    );
    expect(series).toEqual([
      { day: "2026-08-23", calls: 0, tokens: 0, costUsd: 0 },
      { day: "2026-08-24", calls: 3, tokens: 110, costUsd: 0.6 },
    ]);
  });
});

describe("defensive parsing and formatting", () => {
  it("treats junk as zero, never as invented data", () => {
    expect(safeCount("12")).toBe(12);
    expect(safeCount("nope")).toBe(0);
    expect(safeCount(-5)).toBe(0);
    expect(safeCount(Number.NaN)).toBe(0);
    expect(safeMoney("0.123456")).toBeCloseTo(0.123456);
    expect(safeMoney(undefined)).toBe(0);
  });

  it("formats USD with sub-cent honesty", () => {
    expect(formatUsd(0)).toBe("$0.00");
    expect(formatUsd(0.0042)).toBe("$0.0042");
    expect(formatUsd(1234.5)).toBe("$1,234.50");
  });

  it("formats compact counts", () => {
    expect(formatCount(999)).toBe("999");
    expect(formatCount(1234)).toBe("1.2k");
    expect(formatCount(45678)).toBe("46k");
    expect(formatCount(2_500_000)).toBe("2.5M");
  });
});
