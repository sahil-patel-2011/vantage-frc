import { describe, expect, it } from "vitest";
import { reconcilePresence } from "./reconcile";
import {
  comingTonightCount,
  comingTonightLabel,
  isComingTonight,
  unifyPresence,
} from "./unify";

const DATE = "2026-02-10";

describe("unifyPresence — union identity", () => {
  it("counts the same member in RSVP + roll call + hours as ONE person", () => {
    const unified = unifyPresence({
      rsvps: [{ userId: "u1", name: "Ada", response: "going" }],
      rollCall: [{ userId: "u1", name: "Ada", present: true }],
      hourLogs: [
        { userId: "u1", name: "Ada", hourLogId: "h1", minutes: 90 },
        { userId: "u1", name: "Ada", hourLogId: "h2", minutes: 30 },
      ],
      occurrenceDate: DATE,
      rollCallTaken: true,
    });

    expect(unified.comingTonight).toBe(1);
    expect(unified.identityCount).toBe(1);
    expect(unified.parts).toEqual({ rsvpGoing: 1, present: 1, clocked: 1 });
    expect(unified.members).toHaveLength(1);
    expect(unified.members[0]).toMatchObject({
      userId: "u1",
      coming: true,
      sources: ["rsvp", "roll_call", "hours"],
    });
    expect(unified.comingTonight).toBeLessThan(
      unified.parts.rsvpGoing + unified.parts.present + unified.parts.clocked,
    );
  });

  it("counts three different people, one per store, as three — no collapse across identities", () => {
    const unified = unifyPresence({
      rsvps: [{ userId: "u1", name: "Ada", response: "going" }],
      rollCall: [{ userId: "u2", name: "Bo", present: true }],
      hourLogs: [{ userId: "u3", name: "Cy", hourLogId: "h1", minutes: 60 }],
      occurrenceDate: DATE,
      rollCallTaken: true,
    });

    expect(unified.comingTonight).toBe(3);
    expect(unified.identityCount).toBe(3);
    expect(unified.parts).toEqual({ rsvpGoing: 1, present: 1, clocked: 1 });
    expect(unified.members.map((member) => member.userId).sort()).toEqual(["u1", "u2", "u3"]);
  });

  it("does not double-count duplicate signals for the same userId", () => {
    const unified = unifyPresence({
      rsvps: [
        { userId: "u1", name: "Ada", response: "going", scope: "series" },
        { userId: "u1", name: "Ada", response: "going", scope: "occurrence" },
      ],
      rollCall: [
        { userId: "u1", name: "Ada", present: true },
        { userId: "u1", name: "Ada Lovelace", present: true },
      ],
      hourLogs: [
        { userId: "u1", name: "Ada", hourLogId: "h1", minutes: 20 },
        { userId: "u1", name: "Ada", hourLogId: "h2", minutes: 40 },
      ],
      occurrenceDate: DATE,
      rollCallTaken: true,
    });

    expect(unified.comingTonight).toBe(1);
    expect(unified.identityCount).toBe(1);
    expect(unified.members[0].clocked).toBe(true);
  });
});

describe("unifyPresence — no invented people", () => {
  it("returns zero when every store is empty — silence is not a roster of absences", () => {
    const unified = unifyPresence({
      rsvps: [],
      rollCall: [],
      hourLogs: [],
      occurrenceDate: DATE,
    });
    expect(unified.comingTonight).toBe(0);
    expect(unified.identityCount).toBe(0);
    expect(unified.members).toEqual([]);
  });

  it("skips empty user ids instead of minting placeholder people", () => {
    const unified = unifyPresence({
      rsvps: [{ userId: "", name: "Ghost", response: "going" }],
      rollCall: [{ userId: "", name: "Walk-in", present: true }],
      hourLogs: [{ userId: "", name: "Kiosk", hourLogId: "h1", minutes: 15 }],
      occurrenceDate: DATE,
      rollCallTaken: true,
    });
    expect(unified.comingTonight).toBe(0);
    expect(unified.identityCount).toBe(0);
  });

  it("does not count unlinked free-text roll-call names as people", () => {
    const unified = unifyPresence({
      rsvps: [],
      rollCall: [
        { userId: "", name: "Parent volunteer", present: true },
        { userId: "u1", name: "Ada", present: true },
      ],
      hourLogs: [],
      occurrenceDate: DATE,
      rollCallTaken: true,
    });
    expect(unified.comingTonight).toBe(1);
    expect(unified.members.map((member) => member.userId)).toEqual(["u1"]);
  });

  it("never pads the count from a roster that was not passed in", () => {
    const unified = unifyPresence({
      rsvps: [{ userId: "u1", name: "Ada", response: "going" }],
      rollCall: [],
      hourLogs: [],
      occurrenceDate: DATE,
    });
    expect(unified.comingTonight).toBe(1);
    expect(unified.identityCount).toBe(1);
    expect(unified.members.every((member) => member.userId === "u1")).toBe(true);
  });
});

describe("unifyPresence — who counts as coming", () => {
  it("does not treat maybe or no as coming unless they showed up", () => {
    const onlyAnswers = unifyPresence({
      rsvps: [
        { userId: "u1", name: "Ada", response: "maybe" },
        { userId: "u2", name: "Bo", response: "no" },
      ],
      rollCall: [],
      hourLogs: [],
      occurrenceDate: DATE,
    });
    expect(onlyAnswers.comingTonight).toBe(0);
    expect(onlyAnswers.identityCount).toBe(2);

    const showedUp = unifyPresence({
      rsvps: [{ userId: "u2", name: "Bo", response: "no" }],
      rollCall: [{ userId: "u2", name: "Bo", present: true }],
      hourLogs: [],
      occurrenceDate: DATE,
      rollCallTaken: true,
    });
    expect(showedUp.comingTonight).toBe(1);
  });

  it("drops a going RSVP after an explicit absent mark", () => {
    const unified = unifyPresence({
      rsvps: [{ userId: "u1", name: "Ada", response: "going" }],
      rollCall: [{ userId: "u1", name: "Ada", present: false }],
      hourLogs: [],
      occurrenceDate: DATE,
      rollCallTaken: true,
    });
    expect(unified.comingTonight).toBe(0);
    expect(unified.identityCount).toBe(1);
    expect(unified.members[0].coming).toBe(false);
  });

  it("keeps a going RSVP when nobody has taken roll yet", () => {
    const unified = unifyPresence({
      rsvps: [{ userId: "u1", name: "Ada", response: "going" }],
      rollCall: [],
      hourLogs: [],
      occurrenceDate: DATE,
      rollCallTaken: false,
    });
    expect(unified.comingTonight).toBe(1);
  });

  it("counts clocked hours as here even with no RSVP and no roll call", () => {
    const unified = unifyPresence({
      rsvps: [],
      rollCall: [],
      hourLogs: [{ userId: "u1", name: "Ada", hourLogId: "h1", minutes: 45 }],
      occurrenceDate: DATE,
      rollCallTaken: false,
    });
    expect(unified.comingTonight).toBe(1);
    expect(unified.members[0].sources).toEqual(["hours"]);
  });

  it("does not count a zero-minute session as coming", () => {
    const unified = unifyPresence({
      rsvps: [],
      rollCall: [],
      hourLogs: [{ userId: "u1", name: "Ada", hourLogId: "h1", minutes: 0 }],
      occurrenceDate: DATE,
    });
    expect(unified.comingTonight).toBe(0);
    expect(unified.identityCount).toBe(1);
  });
});

describe("comingTonightCount", () => {
  it("matches unifyPresence on reconciled rows and ignores duplicate row ids", () => {
    const input = {
      rsvps: [
        { userId: "u1", name: "Ada", response: "going" as const },
        { userId: "u2", name: "Bo", response: "going" as const },
      ],
      rollCall: [{ userId: "u1", name: "Ada", present: true }],
      hourLogs: [{ userId: "u3", name: "Cy", hourLogId: "h1", minutes: 15 }],
      occurrenceDate: DATE,
      rollCallTaken: true,
    };
    const rows = reconcilePresence(input);
    expect(comingTonightCount(rows)).toBe(unifyPresence(input).comingTonight);
    expect(comingTonightCount([...rows, ...rows])).toBe(3);
  });

  it("skips a row with no userId", () => {
    expect(
      comingTonightCount([
        {
          userId: "",
          name: "Ghost",
          occurrenceDate: DATE,
          rsvp: "going",
          rsvpScope: "occurrence",
          attended: true,
          minutes: 30,
          hourLogIds: [],
          hasOpenSession: false,
          discrepancy: null,
        },
      ]),
    ).toBe(0);
  });
});

describe("isComingTonight / comingTonightLabel", () => {
  it("is a total function over the four fields that matter", () => {
    expect(isComingTonight({ userId: "u1", rsvp: "going", attended: null, minutes: null })).toBe(true);
    expect(isComingTonight({ userId: "u1", rsvp: "going", attended: false, minutes: null })).toBe(false);
    expect(isComingTonight({ userId: "u1", rsvp: "no", attended: true, minutes: null })).toBe(true);
    expect(isComingTonight({ userId: "u1", rsvp: null, attended: null, minutes: 1 })).toBe(true);
    expect(isComingTonight({ userId: "", rsvp: "going", attended: true, minutes: 10 })).toBe(false);
  });

  it("names the sources without adding them into the number", () => {
    expect(comingTonightLabel({ comingTonight: 0, parts: { rsvpGoing: 0, present: 0, clocked: 0 } })).toMatch(
      /Nobody has said/,
    );
    expect(
      comingTonightLabel({ comingTonight: 1, parts: { rsvpGoing: 1, present: 1, clocked: 1 } }),
    ).toBe("1 said going · 1 on the roll call · 1 clocked hours — counted once per person.");
  });
});
