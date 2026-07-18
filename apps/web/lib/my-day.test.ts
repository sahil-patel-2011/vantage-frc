import { describe, expect, it } from "vitest";
import {
  buildMyDayMatch,
  buildMyDayMatches,
  bumperCue,
  freshnessLabel,
  matchAlertBody,
  matchAlertTitle,
  myDayMatchToCalendarEvent,
  scheduleFingerprint,
} from "./my-day";
import type { ScheduleMatch } from "./schedule-board";

const US = "frc1678";

function match(overrides: Partial<ScheduleMatch> = {}): ScheduleMatch {
  return {
    matchKey: "2026casd_qm12",
    compLevel: "qm",
    matchNumber: 12,
    scheduledTime: "2026-03-14T16:30:00.000Z",
    red: [US, "frc254", "frc973"],
    blue: ["frc118", "frc148", "frc2056"],
    redScore: null,
    blueScore: null,
    winningAlliance: null,
    scoutCount: 0,
    ...overrides,
  };
}

describe("bumperCue", () => {
  it("names the bumper color to switch to", () => {
    expect(bumperCue("red")).toBe("Switch to RED bumpers");
    expect(bumperCue("blue")).toBe("Switch to BLUE bumpers");
  });
});

describe("buildMyDayMatch", () => {
  it("splits partners/opponents and builds deep links", () => {
    const built = buildMyDayMatch(match(), { orgId: "org-1", teamKey: US, isNext: true });
    expect(built).not.toBeNull();
    expect(built!.alliance).toBe("red");
    expect(built!.bumperCue).toBe("Switch to RED bumpers");
    expect(built!.matchLabel).toBe("Qual 12");
    expect(built!.partners).toEqual(["254", "973"]);
    expect(built!.opponents).toEqual(["118", "148", "2056"]);
    expect(built!.links.command).toContain("/command?orgId=org-1");
    expect(built!.links.briefing).toContain("matchKey=2026casd_qm12");
  });
});

describe("buildMyDayMatches", () => {
  it("marks the next unscored our match", () => {
    const future = new Date(Date.now() + 2 * 60 * 60_000).toISOString();
    const list = [
      match({
        matchKey: "m1",
        matchNumber: 1,
        redScore: 10,
        blueScore: 8,
        scheduledTime: new Date(Date.now() - 60_000).toISOString(),
      }),
      match({ matchKey: "m2", matchNumber: 2, scheduledTime: future }),
      match({
        matchKey: "m3",
        matchNumber: 3,
        red: ["frc9"],
        blue: ["frc8"],
        scheduledTime: future,
      }),
    ];
    const { next, matches } = buildMyDayMatches(list, { orgId: "org-1", teamKey: US });
    expect(matches.map((entry) => entry.matchKey)).toEqual(["m1", "m2"]);
    expect(next?.matchKey).toBe("m2");
    expect(next?.isNext).toBe(true);
    expect(matchAlertTitle(next!)).toBe("Next match · Qual 2");
    expect(matchAlertBody({ eventName: "Event", match: next!, teamNumber: 1678 })).toContain("RED");
  });
});

describe("scheduleFingerprint", () => {
  it("changes when predicted time or alliance changes", () => {
    const a = scheduleFingerprint([match()], US);
    const b = scheduleFingerprint([match({ scheduledTime: "2026-03-14T17:00:00.000Z" })], US);
    expect(a).not.toBe(b);
  });
});

describe("freshnessLabel", () => {
  it("formats relative sync age", () => {
    const now = Date.parse("2026-03-14T18:00:00.000Z");
    expect(freshnessLabel(null, now)).toBe("Schedule not synced yet");
    expect(freshnessLabel("2026-03-14T17:59:30.000Z", now)).toBe("Synced just now");
  });
});

describe("myDayMatchToCalendarEvent", () => {
  it("emits a 15-minute timed calendar block", () => {
    const built = buildMyDayMatch(match(), { orgId: "org-1", teamKey: US, isNext: true })!;
    const event = myDayMatchToCalendarEvent(built, "San Diego Regional");
    expect(event?.id).toBe("match-2026casd_qm12");
    expect(event?.title).toContain("RED bumpers");
  });
});
