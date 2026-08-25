import { describe, expect, it } from "vitest";
import {
  assembleWeekPrompt,
  deterministicWeek,
  hasWeekMaterial,
  isWeeklyRollupDay,
  renderWeekFacts,
  shiftDay,
  utcWeekday,
  WEEK_DAY_EXCERPT_CHARS,
  WEEK_MIN_DAYS,
  weekWindow,
  type WeekDigest,
} from "./compute-week";

/** 2026-08-22 is a Saturday. */
const SATURDAY = "2026-08-22";

function weekDigest(dayCount: number): WeekDigest {
  const window = weekWindow(SATURDAY);
  return {
    orgName: "Robo Raiders 9999",
    weekStart: window.start,
    weekEnd: window.end,
    days: Array.from({ length: dayCount }, (_, index) => ({
      day: shiftDay(window.start, index),
      content: `Team recap for ${shiftDay(window.start, index)} — day ${index + 1} happened.`,
    })),
  };
}

describe("shiftDay / utcWeekday", () => {
  it("shifts whole UTC days across a month boundary", () => {
    expect(shiftDay("2026-08-31", 1)).toBe("2026-09-01");
    expect(shiftDay("2026-09-01", -1)).toBe("2026-08-31");
    expect(shiftDay("2026-08-22", 0)).toBe("2026-08-22");
  });

  it("shifts across a leap day without drifting", () => {
    expect(shiftDay("2028-02-28", 1)).toBe("2028-02-29");
    expect(shiftDay("2028-02-29", 1)).toBe("2028-03-01");
  });

  it("reads the UTC weekday, not the local one", () => {
    expect(utcWeekday("2026-08-22")).toBe(6);
    expect(utcWeekday("2026-08-23")).toBe(0);
  });

  it("rejects a malformed day rather than silently producing NaN", () => {
    expect(() => shiftDay("2026-8-1", 1)).toThrow();
  });
});

describe("isWeeklyRollupDay", () => {
  it("is true only on UTC Saturday", () => {
    expect(isWeeklyRollupDay("2026-08-22")).toBe(true);
    for (const day of [
      "2026-08-16",
      "2026-08-17",
      "2026-08-18",
      "2026-08-19",
      "2026-08-20",
      "2026-08-21",
    ]) {
      expect(isWeeklyRollupDay(day)).toBe(false);
    }
  });
});

describe("weekWindow", () => {
  it("is the seven days ending on and including the roll-up day", () => {
    expect(weekWindow(SATURDAY)).toEqual({ start: "2026-08-16", end: "2026-08-22" });
  });
});

describe("hasWeekMaterial", () => {
  it("is false below the minimum number of recorded days", () => {
    for (let count = 0; count < WEEK_MIN_DAYS; count += 1) {
      expect(hasWeekMaterial(weekDigest(count))).toBe(false);
    }
  });

  it("is true at and above the minimum", () => {
    expect(hasWeekMaterial(weekDigest(WEEK_MIN_DAYS))).toBe(true);
    expect(hasWeekMaterial(weekDigest(7))).toBe(true);
  });
});

describe("renderWeekFacts", () => {
  it("quotes each recorded day under its own date and nothing else", () => {
    const facts = renderWeekFacts(weekDigest(3));
    expect(facts).toContain("[2026-08-16]");
    expect(facts).toContain("[2026-08-18]");
    // Day four was never recorded, so it must not appear at all.
    expect(facts).not.toContain("[2026-08-19]");
    expect(facts).not.toContain("undefined");
  });

  it("clamps a very long daily recap so the week prompt stays bounded", () => {
    const digest = weekDigest(3);
    digest.days[0]!.content = "x".repeat(5000);
    const facts = renderWeekFacts(digest);
    expect(facts).toContain("…");
    expect(facts.split("\n")[1]!.length).toBeLessThanOrEqual(WEEK_DAY_EXCERPT_CHARS);
  });
});

describe("assembleWeekPrompt", () => {
  it("carries the never-invent contract and the three sections", () => {
    const prompt = assembleWeekPrompt(weekDigest(5));
    expect(prompt).toContain("Never invent");
    expect(prompt).toContain("Do not fill gaps between days");
    expect(prompt).toContain("The week in review");
    expect(prompt).toContain("What is still open");
    expect(prompt).toContain("What next week should start with");
    expect(prompt).toContain('write exactly "Nothing recorded."');
  });

  it("states how many days actually recorded activity", () => {
    const prompt = assembleWeekPrompt(weekDigest(4));
    expect(prompt).toContain("2026-08-16 through 2026-08-22");
    expect(prompt).toContain("4 of those days recorded activity");
    expect(prompt).toContain(renderWeekFacts(weekDigest(4)));
  });
});

describe("deterministicWeek", () => {
  it("is deterministic and says plainly that no model wrote it", () => {
    expect(deterministicWeek(weekDigest(4))).toBe(deterministicWeek(weekDigest(4)));
    const text = deterministicWeek(weekDigest(4));
    expect(text).toContain("Week in review 2026-08-16 — 2026-08-22");
    expect(text).toContain("from 4 daily recaps");
    expect(text).toContain("no AI summary available");
    expect(text).not.toContain("undefined");
  });
});
