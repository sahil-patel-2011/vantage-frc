import { describe, expect, it } from "vitest";
import {
  MAX_REPORTED_CONFLICTS,
  type ConflictEvent,
  describeConflicts,
  findConflicts,
} from "./conflicts";

/** 2026-02-10 is a Tuesday — an ordinary build night. */
function at(hour: number, minute = 0): string {
  return new Date(Date.UTC(2026, 1, 10, hour, minute)).toISOString();
}

function event(over: Partial<ConflictEvent> & { id: string }): ConflictEvent {
  return {
    title: "Build night",
    startsAt: at(18),
    endsAt: at(21),
    subteamId: null,
    subteamName: null,
    ...over,
  };
}

describe("findConflicts", () => {
  it("finds a whole-team meeting sitting on the proposed hour", () => {
    const found = findConflicts(
      { startsAt: at(18), endsAt: at(20), subteamId: null },
      [event({ id: "a", title: "All-hands" })],
    );
    expect(found).toHaveLength(1);
    expect(found[0]!.event.title).toBe("All-hands");
    expect(found[0]!.reason).toBe("whole-team");
  });

  it("says nothing when the calendar is clear", () => {
    const found = findConflicts({ startsAt: at(18), endsAt: at(20), subteamId: null }, []);
    expect(found).toEqual([]);
  });

  /*
    The case the whole module exists for. Two subteams working in two rooms at
    the same time is a normal Tuesday; warning about it would train people to
    dismiss the warning, and then it would not work for the real ones either.
  */
  it("does not call two different subteams at the same hour a conflict", () => {
    const found = findConflicts(
      { startsAt: at(18), endsAt: at(21), subteamId: "mech" },
      [event({ id: "a", title: "Programming", subteamId: "prog", subteamName: "Programming" })],
    );
    expect(found).toEqual([]);
  });

  it("does flag the same subteam twice over", () => {
    const found = findConflicts(
      { startsAt: at(18), endsAt: at(21), subteamId: "mech" },
      [event({ id: "a", title: "Gearbox rebuild", subteamId: "mech", subteamName: "Mechanical" })],
    );
    expect(found).toHaveLength(1);
    expect(found[0]!.reason).toBe("same-subteam");
  });

  it("flags a whole-team event against a subteam's evening, in both directions", () => {
    const wholeTeamExists = findConflicts(
      { startsAt: at(18), endsAt: at(21), subteamId: "mech" },
      [event({ id: "a", title: "Sponsor night", subteamId: null })],
    );
    expect(wholeTeamExists).toHaveLength(1);

    const wholeTeamProposed = findConflicts(
      { startsAt: at(18), endsAt: at(21), subteamId: null },
      [event({ id: "a", title: "Gearbox rebuild", subteamId: "mech", subteamName: "Mechanical" })],
    );
    expect(wholeTeamProposed).toHaveLength(1);
  });

  it("treats back-to-back as back-to-back, not as a clash", () => {
    const found = findConflicts(
      { startsAt: at(21), endsAt: at(23), subteamId: null },
      [event({ id: "a", startsAt: at(18), endsAt: at(21) })],
    );
    expect(found).toEqual([]);
  });

  it("catches an event that starts inside another and runs past it", () => {
    const found = findConflicts(
      { startsAt: at(20), endsAt: at(23), subteamId: null },
      [event({ id: "a", startsAt: at(18), endsAt: at(21) })],
    );
    expect(found).toHaveLength(1);
  });

  it("catches an event entirely swallowed by a longer one", () => {
    const found = findConflicts(
      { startsAt: at(19), endsAt: at(20), subteamId: null },
      [event({ id: "a", startsAt: at(18), endsAt: at(22) })],
    );
    expect(found).toHaveLength(1);
  });

  it("does not report the event being edited against itself", () => {
    const existing = event({ id: "same" });
    const found = findConflicts(
      { id: "same", startsAt: at(18), endsAt: at(21), subteamId: null },
      [existing],
    );
    expect(found).toEqual([]);
  });

  describe("entries with no stated end", () => {
    /*
      An entry with no end occupies an hour — the shortest thing worth
      protecting. Zero-length would let anything be booked straight over it,
      and a whole evening would be inventing data.

      This rule is shared with the AI scheduler's `conflictsWith` rather than
      restated, so "Find a time" and this warning can never disagree about
      whether 6pm is free. These tests pin the convention itself.
    */
    it("gives an entry with no end exactly one hour", () => {
      const inside = findConflicts(
        { startsAt: at(18, 30), endsAt: at(19), subteamId: null },
        [event({ id: "a", startsAt: at(18), endsAt: null })],
      );
      expect(inside, "18:30 is inside the 18:00–19:00 an entry claims").toHaveLength(1);

      const after = findConflicts(
        { startsAt: at(19), endsAt: at(20), subteamId: null },
        [event({ id: "a", startsAt: at(18), endsAt: null })],
      );
      expect(after, "19:00 is where that hour ends — touching, not overlapping").toEqual([]);
    });

    it("flags an open-ended entry that starts mid-meeting", () => {
      const found = findConflicts(
        { startsAt: at(18), endsAt: at(21), subteamId: null },
        [event({ id: "a", title: "Pizza run", startsAt: at(19), endsAt: null })],
      );
      expect(found).toHaveLength(1);
    });

    it("leaves an open-ended entry that starts after the meeting alone", () => {
      const found = findConflicts(
        { startsAt: at(18), endsAt: at(21), subteamId: null },
        [event({ id: "a", title: "Pizza run", startsAt: at(22), endsAt: null })],
      );
      expect(found).toEqual([]);
    });

    it("overlaps two open-ended entries only while their hours share time", () => {
      const same = findConflicts(
        { startsAt: at(18), endsAt: null, subteamId: null },
        [event({ id: "a", startsAt: at(18), endsAt: null })],
      );
      expect(same).toHaveLength(1);

      const straddling = findConflicts(
        { startsAt: at(18), endsAt: null, subteamId: null },
        [event({ id: "a", startsAt: at(18, 30), endsAt: null })],
      );
      expect(straddling, "18:00–19:00 and 18:30–19:30 share half an hour").toHaveLength(1);

      const apart = findConflicts(
        { startsAt: at(18), endsAt: null, subteamId: null },
        [event({ id: "a", startsAt: at(19), endsAt: null })],
      );
      expect(apart).toEqual([]);
    });
  });

  describe("half-typed and malformed input", () => {
    it("stays quiet while a datetime field is mid-keystroke", () => {
      expect(findConflicts({ startsAt: "", endsAt: null, subteamId: null }, [event({ id: "a" })])).toEqual([]);
      expect(
        findConflicts({ startsAt: "not a date", endsAt: null, subteamId: null }, [event({ id: "a" })]),
      ).toEqual([]);
    });

    it("says nothing about a range that ends before it starts", () => {
      const found = findConflicts(
        { startsAt: at(21), endsAt: at(18), subteamId: null },
        [event({ id: "a" })],
      );
      expect(found).toEqual([]);
    });

    it("skips a stored row whose own end precedes its start", () => {
      const found = findConflicts(
        { startsAt: at(18), endsAt: at(21), subteamId: null },
        [event({ id: "a", startsAt: at(20), endsAt: at(19) })],
      );
      expect(found).toEqual([]);
    });
  });

  it("returns the soonest first and caps how many it reports", () => {
    const many = Array.from({ length: 9 }, (_, i) =>
      event({ id: `e${i}`, title: `Event ${i}`, startsAt: at(18, 50 - i), endsAt: at(21) }),
    );
    const found = findConflicts({ startsAt: at(18), endsAt: at(22), subteamId: null }, many);
    expect(found).toHaveLength(MAX_REPORTED_CONFLICTS);
    expect(found[0]!.event.title).toBe("Event 8");
    expect(found.map((c) => c.event.title)).toEqual(["Event 8", "Event 7", "Event 6", "Event 5"]);
  });
});

describe("describeConflicts", () => {
  it("renders nothing when there is nothing to say", () => {
    expect(describeConflicts([])).toBeNull();
  });

  it("names the event rather than counting it", () => {
    const text = describeConflicts([
      { event: event({ id: "a", title: "All-hands" }), reason: "whole-team" },
    ]);
    expect(text).toBe("Overlaps All-hands, which the whole team is already expected at.");
  });

  it("names the subteam that is double-booked", () => {
    const text = describeConflicts([
      {
        event: event({ id: "a", title: "Gearbox rebuild", subteamId: "mech", subteamName: "Mechanical" }),
        reason: "same-subteam",
      },
    ]);
    expect(text).toContain("Mechanical is already expected at");
  });

  it("leads with one and counts the rest", () => {
    const text = describeConflicts([
      { event: event({ id: "a", title: "All-hands" }), reason: "whole-team" },
      { event: event({ id: "b", title: "Sponsor call" }), reason: "whole-team" },
      { event: event({ id: "c", title: "Safety talk" }), reason: "whole-team" },
    ]);
    expect(text).toContain("All-hands");
    expect(text).toContain("2 others at the same time");
  });

  it("gets the singular right for exactly one other", () => {
    const text = describeConflicts([
      { event: event({ id: "a", title: "All-hands" }), reason: "whole-team" },
      { event: event({ id: "b", title: "Sponsor call" }), reason: "whole-team" },
    ]);
    expect(text).toContain("1 other at the same time");
    expect(text).not.toContain("1 others");
  });
});
