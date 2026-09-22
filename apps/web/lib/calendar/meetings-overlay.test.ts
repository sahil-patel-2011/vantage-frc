import { describe, expect, it } from "vitest";
import {
  MAX_MEETINGS_PER_DAY,
  groupMeetingsByDay,
  meetingTimeLabel,
  type OverlayMeeting,
} from "./meetings-overlay";

/**
 * These run in whatever zone the box is set to, which is the point: the whole
 * question this module answers is "which square does this instant go in for
 * the person reading the grid". Times are therefore built from local wall
 * clock rather than pinned to UTC, so the assertions mean the same thing
 * wherever they run.
 */
function at(day: string, hour: number, minute = 0): string {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(year, month - 1, date, hour, minute, 0, 0).toISOString();
}

const meeting = (over: Partial<OverlayMeeting> & { id: string; startsAt: string }): OverlayMeeting => ({
  title: "Build night",
  endsAt: null,
  subteamName: null,
  subteamColor: null,
  ...over,
});

describe("which square a meeting lands in", () => {
  it("puts a meeting on the day it starts, in the reader's own zone", () => {
    const byDay = groupMeetingsByDay([meeting({ id: "a", startsAt: at("2027-02-09", 18) })]);
    expect([...byDay.keys()]).toEqual(["2027-02-09"]);
  });

  it("keeps a late build night on the night it started", () => {
    // 9pm to 12:30am is Tuesday's build night. Splitting it across two squares
    // would claim the team met twice.
    const byDay = groupMeetingsByDay([
      meeting({ id: "a", startsAt: at("2027-02-09", 21), endsAt: at("2027-02-10", 0, 30) }),
    ]);
    expect([...byDay.keys()]).toEqual(["2027-02-09"]);
  });

  it("orders a day earliest first", () => {
    const byDay = groupMeetingsByDay([
      meeting({ id: "late", title: "Drive practice", startsAt: at("2027-02-09", 19) }),
      meeting({ id: "early", title: "Standup", startsAt: at("2027-02-09", 8) }),
    ]);
    expect(byDay.get("2027-02-09")?.map((m) => m.id)).toEqual(["early", "late"]);
  });

  it("breaks a tie by title rather than by whatever the database returned", () => {
    const byDay = groupMeetingsByDay([
      meeting({ id: "b", title: "Programming", startsAt: at("2027-02-09", 18) }),
      meeting({ id: "a", title: "Mechanical", startsAt: at("2027-02-09", 18) }),
    ]);
    expect(byDay.get("2027-02-09")?.map((m) => m.title)).toEqual(["Mechanical", "Programming"]);
  });

  it("ignores a row whose timestamp is not a timestamp", () => {
    const byDay = groupMeetingsByDay([
      meeting({ id: "bad", startsAt: "sometime tuesday" }),
      meeting({ id: "good", startsAt: at("2027-02-09", 18) }),
    ]);
    expect(byDay.size).toBe(1);
    expect(byDay.get("2027-02-09")).toHaveLength(1);
  });

  it("caps one day so a runaway rule cannot cost the whole render", () => {
    const many = Array.from({ length: MAX_MEETINGS_PER_DAY + 8 }, (_, index) =>
      meeting({ id: `m${index}`, startsAt: at("2027-02-09", 6 + (index % 12)) }),
    );
    expect(groupMeetingsByDay(many).get("2027-02-09")).toHaveLength(MAX_MEETINGS_PER_DAY);
  });

  it("separates two days without leaking one into the other", () => {
    const byDay = groupMeetingsByDay([
      meeting({ id: "tue", startsAt: at("2027-02-09", 18) }),
      meeting({ id: "thu", startsAt: at("2027-02-11", 18) }),
    ]);
    expect(byDay.get("2027-02-09")?.map((m) => m.id)).toEqual(["tue"]);
    expect(byDay.get("2027-02-11")?.map((m) => m.id)).toEqual(["thu"]);
  });
});

describe("the time, short enough for a grid cell", () => {
  it("drops :00 on the hour", () => {
    expect(meetingTimeLabel(at("2027-02-09", 18), null)).toBe("6 PM");
  });

  it("keeps the minutes when there are any", () => {
    expect(meetingTimeLabel(at("2027-02-09", 18, 30), null)).toBe("6:30 PM");
  });

  it("says AM and PM the way a clock does at noon and midnight", () => {
    expect(meetingTimeLabel(at("2027-02-09", 12), null)).toBe("12 PM");
    expect(meetingTimeLabel(at("2027-02-09", 0), null)).toBe("12 AM");
  });

  it("writes a range, and says the meridiem once when both ends share it", () => {
    expect(meetingTimeLabel(at("2027-02-09", 18), at("2027-02-09", 21))).toBe("6–9 PM");
  });

  it("says the meridiem twice when the meeting crosses noon", () => {
    expect(meetingTimeLabel(at("2027-02-13", 10), at("2027-02-13", 16))).toBe("10 AM–4 PM");
  });

  it("shows only the start when the end is on another day", () => {
    // "9 PM–12 AM" reads as a mistake rather than as a late night.
    expect(meetingTimeLabel(at("2027-02-09", 21), at("2027-02-10", 0, 30))).toBe("9 PM");
  });

  it("shows only the start when the end is missing or backwards", () => {
    expect(meetingTimeLabel(at("2027-02-09", 18), null)).toBe("6 PM");
    expect(meetingTimeLabel(at("2027-02-09", 18), at("2027-02-09", 17))).toBe("6 PM");
    expect(meetingTimeLabel(at("2027-02-09", 18), "not a time")).toBe("6 PM");
  });

  it("is empty rather than 'Invalid Date' when the start is unusable", () => {
    expect(meetingTimeLabel("whenever", null)).toBe("");
  });
});
