import { describe, expect, it } from "vitest";
import { describeShopTime, shopTimeLeft } from "./shop-time-left";
import type { OverlayMeeting } from "./meetings-overlay";
import type { Milestone, MilestoneKind } from "../season-calendar";

/** Local wall clock, because "which day is that" is the whole question. */
function at(day: string, hour = 0, minute = 0): Date {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(year, month - 1, date, hour, minute, 0, 0);
}

const milestone = (over: Partial<Milestone> & { id: string; startsOn: string }): Milestone => ({
  title: "Week 1 Regional",
  kind: "event" as MilestoneKind,
  endsOn: null,
  notes: "",
  meetingUrl: null,
  done: false,
  doneAt: null,
  doneByName: null,
  createdByName: null,
  ...over,
});

const session = (day: string, startHour: number, endHour: number | null): OverlayMeeting => ({
  id: `${day}-${startHour}`,
  title: "Build night",
  startsAt: at(day, startHour).toISOString(),
  endsAt: endHour === null ? null : at(day, endHour).toISOString(),
  subteamName: null,
  subteamColor: null,
});

const NOW = at("2027-01-11", 9);

describe("what is left before the competition", () => {
  it("counts the sessions and the hours between now and it", () => {
    const left = shopTimeLeft(
      [milestone({ id: "comp", startsOn: "2027-01-22" })],
      [
        session("2027-01-12", 18, 21),
        session("2027-01-14", 18, 21),
        session("2027-01-16", 10, 16),
      ],
      NOW,
    );
    expect(left).toMatchObject({ sessions: 3, hours: 12, daysUntil: 11, targetTitle: "Week 1 Regional" });
  });

  it("does not count a build night that has already finished", () => {
    const left = shopTimeLeft(
      [milestone({ id: "comp", startsOn: "2027-01-22" })],
      [session("2027-01-09", 18, 21), session("2027-01-12", 18, 21)],
      NOW,
    );
    expect(left?.sessions).toBe(1);
  });

  it("counts from this moment, not from midnight", () => {
    // 6am today is over by 9am. Counting from midnight would hand the team
    // three hours it has already spent.
    const left = shopTimeLeft(
      [milestone({ id: "comp", startsOn: "2027-01-22" })],
      [session("2027-01-11", 6, 9), session("2027-01-11", 18, 21)],
      NOW,
    );
    expect(left?.sessions).toBe(1);
    expect(left?.hours).toBe(3);
  });

  it("stops at the competition, because its own day is not shop time", () => {
    const left = shopTimeLeft(
      [milestone({ id: "comp", startsOn: "2027-01-22" })],
      [session("2027-01-21", 18, 21), session("2027-01-22", 8, 20), session("2027-01-25", 18, 21)],
      NOW,
    );
    expect(left?.sessions).toBe(1);
  });

  it("counts down to the nearest one, not the first in the list", () => {
    const left = shopTimeLeft(
      [
        milestone({ id: "late", title: "Champs", startsOn: "2027-04-20" }),
        milestone({ id: "soon", title: "Week 1", startsOn: "2027-01-22" }),
      ],
      [session("2027-01-12", 18, 21)],
      NOW,
    );
    expect(left?.targetTitle).toBe("Week 1");
  });

  it("counts a deadline as something to build toward", () => {
    const left = shopTimeLeft(
      [milestone({ id: "bag", title: "Stop build", kind: "deadline", startsOn: "2027-02-16" })],
      [session("2027-01-12", 18, 21)],
      NOW,
    );
    expect(left?.targetKind).toBe("deadline");
  });

  it("skips a competition already marked done", () => {
    const left = shopTimeLeft(
      [
        milestone({ id: "done", title: "Scrimmage", startsOn: "2027-01-15", done: true }),
        milestone({ id: "next", title: "Week 1", startsOn: "2027-01-22" }),
      ],
      [session("2027-01-12", 18, 21)],
      NOW,
    );
    expect(left?.targetTitle).toBe("Week 1");
  });

  it("ignores milestones that are not something to build toward", () => {
    expect(
      shopTimeLeft(
        [milestone({ id: "m", title: "Design review", kind: "design", startsOn: "2027-01-20" })],
        [session("2027-01-12", 18, 21)],
        NOW,
      ),
    ).toBeNull();
  });
});

describe("a practice schedule written on the season calendar", () => {
  // The repeat control on /calendar creates whole-day milestones, not timed
  // meetings. A team that used it was told nothing was scheduled.
  const practice = (day: string) =>
    milestone({ id: `p-${day}`, title: "Practice", kind: "practice", startsOn: day });

  it("counts practice entries as sessions", () => {
    const left = shopTimeLeft(
      [milestone({ id: "comp", startsOn: "2027-01-22" }), practice("2027-01-12"), practice("2027-01-14")],
      [],
      NOW,
    );
    expect(left).toMatchObject({ sessions: 2, hours: 0, sessionsWithoutEnd: 2 });
  });

  it("adds them to the timed meetings rather than replacing them", () => {
    const left = shopTimeLeft(
      [milestone({ id: "comp", startsOn: "2027-01-22" }), practice("2027-01-12")],
      [session("2027-01-14", 18, 21)],
      NOW,
    );
    expect(left).toMatchObject({ sessions: 2, hours: 3, sessionsWithoutEnd: 1 });
    expect(describeShopTime(left!)).toBe("2 sessions — 3 hours from the 1 with a time");
  });

  it("counts build and meeting entries too, and not a competition", () => {
    const left = shopTimeLeft(
      [
        milestone({ id: "comp", startsOn: "2027-01-22" }),
        milestone({ id: "b", title: "Build", kind: "build", startsOn: "2027-01-12" }),
        milestone({ id: "m", title: "Meeting", kind: "meeting", startsOn: "2027-01-13" }),
        milestone({ id: "o", title: "Outreach", kind: "outreach", startsOn: "2027-01-14" }),
      ],
      [],
      NOW,
    );
    expect(left?.sessions).toBe(2);
  });

  it("does not count one that has already happened, or one past the competition", () => {
    const left = shopTimeLeft(
      [milestone({ id: "comp", startsOn: "2027-01-22" }), practice("2027-01-05"), practice("2027-01-25")],
      [],
      NOW,
    );
    expect(left).toBeNull();
  });

  it("counts today's practice, which has not happened yet at nine in the morning", () => {
    // Meetings are counted from this instant because they have one. A
    // whole-day entry does not, so dropping it at midnight would delete a
    // practice the team is about to walk into.
    const left = shopTimeLeft(
      [milestone({ id: "comp", startsOn: "2027-01-22" }), practice("2027-01-11")],
      [],
      NOW,
    );
    expect(left?.sessions).toBe(1);
  });

  it("skips one already ticked off", () => {
    const left = shopTimeLeft(
      [
        milestone({ id: "comp", startsOn: "2027-01-22" }),
        { ...practice("2027-01-12"), done: true },
        practice("2027-01-14"),
      ],
      [],
      NOW,
    );
    expect(left?.sessions).toBe(1);
  });
});

describe("the honest nulls", () => {
  it("says nothing when there is nothing to count down to", () => {
    expect(shopTimeLeft([], [session("2027-01-12", 18, 21)], NOW)).toBeNull();
  });

  it("says nothing when the competition has already passed", () => {
    expect(
      shopTimeLeft(
        [milestone({ id: "past", startsOn: "2027-01-04" })],
        [session("2027-01-12", 18, 21)],
        NOW,
      ),
    ).toBeNull();
  });

  it("says nothing rather than zero when no build nights are scheduled", () => {
    // "0 sessions left" reads as a countdown that has run out. The truth is
    // that the team has not told the calendar when it meets.
    expect(shopTimeLeft([milestone({ id: "comp", startsOn: "2027-01-22" })], [], NOW)).toBeNull();
  });

  it("ignores a row whose timestamp is not a timestamp", () => {
    const left = shopTimeLeft(
      [milestone({ id: "comp", startsOn: "2027-01-22" })],
      [{ ...session("2027-01-12", 18, 21), startsAt: "thursday-ish" }, session("2027-01-14", 18, 21)],
      NOW,
    );
    expect(left?.sessions).toBe(1);
  });
});

describe("sessions with no end time", () => {
  it("counts the session but not the hours, and says how many", () => {
    const left = shopTimeLeft(
      [milestone({ id: "comp", startsOn: "2027-01-22" })],
      [session("2027-01-12", 18, 21), session("2027-01-14", 18, null)],
      NOW,
    );
    expect(left).toMatchObject({ sessions: 2, hours: 3, sessionsWithoutEnd: 1 });
  });

  it("treats a backwards end time as no end time rather than negative hours", () => {
    const left = shopTimeLeft(
      [milestone({ id: "comp", startsOn: "2027-01-22" })],
      [session("2027-01-12", 21, 18)],
      NOW,
    );
    expect(left).toMatchObject({ sessions: 1, hours: 0, sessionsWithoutEnd: 1 });
  });

  it("rounds to the half hour so the number reads like a plan", () => {
    const left = shopTimeLeft(
      [milestone({ id: "comp", startsOn: "2027-01-22" })],
      [
        {
          ...session("2027-01-12", 18, 21),
          endsAt: at("2027-01-12", 20, 50).toISOString(),
        },
      ],
      NOW,
    );
    expect(left?.hours).toBe(3);
  });
});

describe("saying it in a sentence", () => {
  const base = {
    targetTitle: "Week 1",
    targetDate: "2027-01-22",
    targetKind: "event" as MilestoneKind,
    daysUntil: 11,
  };

  it("reads as sessions and hours", () => {
    expect(describeShopTime({ ...base, sessions: 14, hours: 42, sessionsWithoutEnd: 0 })).toBe(
      "14 sessions — 42 hours",
    );
  });

  it("says which sessions the hours came from when some had no end", () => {
    // "42 hours" beside fourteen sessions, four of which were not counted, is
    // a number a team would plan against and be wrong.
    expect(describeShopTime({ ...base, sessions: 14, hours: 30, sessionsWithoutEnd: 4 })).toBe(
      "14 sessions — 30 hours from the 10 with a time",
    );
  });

  it("drops the hours entirely rather than claiming zero", () => {
    expect(describeShopTime({ ...base, sessions: 6, hours: 0, sessionsWithoutEnd: 6 })).toBe(
      "6 sessions",
    );
  });

  it("says one session and one hour in the singular", () => {
    expect(describeShopTime({ ...base, sessions: 1, hours: 1, sessionsWithoutEnd: 0 })).toBe(
      "1 session — 1 hour",
    );
  });
});
