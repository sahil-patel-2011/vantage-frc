import { describe, expect, it } from "vitest";
import { diffDays, isIsoDate, resolveDueDates, shiftIsoDate, type ScheduleItemInput } from "./schedule";
import type { ReadinessStatus } from "./types";

function item(
  id: string,
  overrides: Partial<Pick<ScheduleItemInput, "dueOn" | "daysBefore">> & { status?: ReadinessStatus } = {},
): ScheduleItemInput {
  return {
    id,
    dueOn: overrides.dueOn ?? null,
    daysBefore: overrides.daysBefore ?? null,
    status: overrides.status ?? "todo",
  };
}

describe("date helpers", () => {
  it("validates ISO dates strictly", () => {
    expect(isIsoDate("2026-03-12")).toBe(true);
    expect(isIsoDate("2026-02-30")).toBe(false);
    expect(isIsoDate("2026-3-12")).toBe(false);
    expect(isIsoDate(null)).toBe(false);
  });

  it("shifts across month boundaries", () => {
    expect(shiftIsoDate("2026-03-12", -14)).toBe("2026-02-26");
    expect(shiftIsoDate("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("diffs whole days", () => {
    expect(diffDays("2026-03-05", "2026-03-12")).toBe(7);
    expect(diffDays("2026-03-12", "2026-03-05")).toBe(-7);
  });
});

describe("resolveDueDates", () => {
  // Pinned to real calendar dates: the 2026 week-one regional window.
  const eventStartDate = "2026-03-12";
  const today = "2026-03-05";

  it("dates offset items from the event start and orders the countdown chronologically", () => {
    const countdown = resolveDueDates({
      eventStartDate,
      today,
      items: [
        item("packed", { daysBefore: 1 }),
        item("consent", { daysBefore: 7 }),
        item("travel", { daysBefore: 14 }),
        item("absolute", { dueOn: "2026-03-10" }),
      ],
    });
    expect(countdown.groups.map((g) => g.dueOn)).toEqual([
      "2026-02-26",
      "2026-03-05",
      "2026-03-10",
      "2026-03-11",
    ]);
    expect(countdown.groups.map((g) => g.daysBeforeEvent)).toEqual([14, 7, 2, 1]);
    expect(countdown.undated).toHaveLength(0);
  });

  it("prefers an absolute due_on over days_before", () => {
    const countdown = resolveDueDates({
      eventStartDate,
      today,
      items: [item("both", { dueOn: "2026-03-09", daysBefore: 14 })],
    });
    expect(countdown.groups).toHaveLength(1);
    expect(countdown.groups[0]?.dueOn).toBe("2026-03-09");
  });

  it("lists items with neither date as no-date and never defaults them", () => {
    const countdown = resolveDueDates({ eventStartDate, today, items: [item("floating")] });
    expect(countdown.groups).toHaveLength(0);
    expect(countdown.undated).toHaveLength(1);
    expect(countdown.undated[0]?.flag).toBe("no_date");
    expect(countdown.undated[0]?.resolvedDueOn).toBeNull();
  });

  it("flags overdue, at-risk, and scheduled relative to the given real date", () => {
    const countdown = resolveDueDates({
      eventStartDate,
      today,
      items: [
        item("late", { dueOn: "2026-03-04" }),
        item("today", { dueOn: "2026-03-05" }),
        item("soon", { dueOn: "2026-03-07" }),
        item("later", { dueOn: "2026-03-11" }),
      ],
    });
    const flags = new Map(countdown.groups.flatMap((g) => g.items.map((i) => [i.id, i.flag])));
    expect(flags.get("late")).toBe("overdue");
    expect(flags.get("today")).toBe("at_risk");
    expect(flags.get("soon")).toBe("at_risk");
    expect(flags.get("later")).toBe("scheduled");
    expect(countdown.overdueCount).toBe(1);
    expect(countdown.atRiskCount).toBe(2);
  });

  it("closed items are done regardless of date, and counts reconcile", () => {
    const countdown = resolveDueDates({
      eventStartDate,
      today,
      items: [
        item("done-late", { dueOn: "2026-03-01", status: "done" }),
        item("na", { status: "not_applicable" }),
        item("blocked", { dueOn: "2026-03-02", status: "blocked" }),
      ],
    });
    const doneLate = countdown.groups.flatMap((g) => g.items).find((i) => i.id === "done-late");
    expect(doneLate?.flag).toBe("done");
    expect(countdown.undated.find((i) => i.id === "na")?.flag).toBe("done");
    expect(countdown.doneCount).toBe(2);
    expect(countdown.openCount).toBe(1);
    expect(countdown.overdueCount).toBe(1); // blocked item past due stays overdue
  });
});
