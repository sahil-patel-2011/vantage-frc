import { describe, expect, it } from "vitest";
import {
  PRESENCE_DASHBOARD_WIDGET_TYPE,
  presenceDashboardComingTonight,
  presenceDashboardNumber,
} from "./dashboard-number";
import { comingTonightLabel, unifyPresence } from "./unify";

const DATE = "2026-02-10";

describe("presenceDashboardNumber — union by userId", () => {
  it("counts the same member in RSVP + roll call + hours as ONE person", () => {
    const payload = presenceDashboardNumber({
      rsvps: [{ userId: "u1", name: "Ada", response: "going" }],
      rollCall: [{ userId: "u1", name: "Ada", present: true }],
      hourLogs: [
        { userId: "u1", name: "Ada", hourLogId: "h1", minutes: 90 },
        { userId: "u1", name: "Ada", hourLogId: "h2", minutes: 30 },
      ],
      occurrenceDate: DATE,
      rollCallTaken: true,
    });

    expect(payload.type).toBe(PRESENCE_DASHBOARD_WIDGET_TYPE);
    expect(payload.status).toBe("live");
    expect(payload.data.comingTonight).toBe(1);
    expect(payload.data.userIds).toEqual(["u1"]);
    expect(payload.data.identityCount).toBe(1);
    expect(payload.data.parts).toEqual({ rsvpGoing: 1, present: 1, clocked: 1 });
    expect(payload.data.comingTonight).toBeLessThan(
      payload.data.parts.rsvpGoing + payload.data.parts.present + payload.data.parts.clocked,
    );
    expect(payload.data.href).toBe("/presence");
    expect(payload.data.ctaLabel).toBe("Open Presence");
  });

  it("counts three different people, one per store, as three", () => {
    const payload = presenceDashboardNumber({
      rsvps: [{ userId: "u1", name: "Ada", response: "going" }],
      rollCall: [{ userId: "u2", name: "Bo", present: true }],
      hourLogs: [{ userId: "u3", name: "Cy", hourLogId: "h1", minutes: 60 }],
      occurrenceDate: DATE,
      rollCallTaken: true,
    });

    expect(payload.data.comingTonight).toBe(3);
    expect(payload.data.userIds.sort()).toEqual(["u1", "u2", "u3"]);
    expect(payload.data.comingTonight).toBe(payload.data.userIds.length);
  });

  it("does not double-count duplicate signals for the same userId", () => {
    const payload = presenceDashboardNumber({
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

    expect(payload.data.comingTonight).toBe(1);
    expect(payload.data.userIds).toEqual(["u1"]);
  });

  it("matches unifyPresence and comingTonightLabel so widgets do not invent a second number", () => {
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
    const unified = unifyPresence(input);
    const fromSignals = presenceDashboardNumber(input);
    const fromUnification = presenceDashboardNumber(unified);
    const fromWrapped = presenceDashboardNumber({ unification: unified });

    expect(fromSignals.data.comingTonight).toBe(unified.comingTonight);
    expect(fromUnification.data).toEqual(fromSignals.data);
    expect(fromWrapped.data).toEqual(fromSignals.data);
    expect(fromSignals.data.label).toBe(
      comingTonightLabel({ comingTonight: unified.comingTonight, parts: unified.parts }),
    );
    expect(fromSignals.message).toBe(fromSignals.data.label);
    expect(presenceDashboardComingTonight(input)).toBe(unified.comingTonight);
  });

  it("re-derives the number from coming userIds when a stale unification count is passed in", () => {
    const unified = unifyPresence({
      rsvps: [{ userId: "u1", name: "Ada", response: "going" }],
      rollCall: [],
      hourLogs: [],
      occurrenceDate: DATE,
    });
    const payload = presenceDashboardNumber({
      ...unified,
      comingTonight: 99,
      members: [...unified.members, ...unified.members],
    });
    expect(payload.data.comingTonight).toBe(1);
    expect(payload.data.userIds).toEqual(["u1"]);
    expect(payload.data.identityCount).toBe(1);
  });
});

describe("presenceDashboardNumber — no invented people", () => {
  it("is empty when every store is silent — not a roster of absences", () => {
    const payload = presenceDashboardNumber({
      rsvps: [],
      rollCall: [],
      hourLogs: [],
      occurrenceDate: DATE,
    });
    expect(payload.status).toBe("empty");
    expect(payload.data.comingTonight).toBe(0);
    expect(payload.data.userIds).toEqual([]);
    expect(payload.data.identityCount).toBe(0);
    expect(payload.data.href).toBe("/presence");
    expect(payload.message).toMatch(/Nobody has said/);
  });

  it("skips empty user ids instead of minting placeholder people", () => {
    const payload = presenceDashboardNumber({
      rsvps: [{ userId: "", name: "Ghost", response: "going" }],
      rollCall: [{ userId: "", name: "Walk-in", present: true }],
      hourLogs: [{ userId: "", name: "Kiosk", hourLogId: "h1", minutes: 15 }],
      occurrenceDate: DATE,
      rollCallTaken: true,
    });
    expect(payload.data.comingTonight).toBe(0);
    expect(payload.data.userIds).toEqual([]);
    expect(payload.status).toBe("empty");
  });

  it("does not count unlinked free-text roll-call names as people", () => {
    const payload = presenceDashboardNumber({
      rsvps: [],
      rollCall: [
        { userId: "", name: "Parent volunteer", present: true },
        { userId: "u1", name: "Ada", present: true },
      ],
      hourLogs: [],
      occurrenceDate: DATE,
      rollCallTaken: true,
    });
    expect(payload.data.comingTonight).toBe(1);
    expect(payload.data.userIds).toEqual(["u1"]);
  });

  it("never pads the count from a roster that was not passed in", () => {
    const payload = presenceDashboardNumber({
      rsvps: [{ userId: "u1", name: "Ada", response: "going" }],
      rollCall: [],
      hourLogs: [],
      occurrenceDate: DATE,
    });
    expect(payload.data.comingTonight).toBe(1);
    expect(payload.data.userIds).toEqual(["u1"]);
    expect(payload.data.identityCount).toBe(1);
  });

  it("does not treat maybe or no as coming unless they showed up", () => {
    const onlyAnswers = presenceDashboardNumber({
      rsvps: [
        { userId: "u1", name: "Ada", response: "maybe" },
        { userId: "u2", name: "Bo", response: "no" },
      ],
      rollCall: [],
      hourLogs: [],
      occurrenceDate: DATE,
    });
    expect(onlyAnswers.data.comingTonight).toBe(0);
    expect(onlyAnswers.data.userIds).toEqual([]);
    expect(onlyAnswers.data.identityCount).toBe(2);
    expect(onlyAnswers.status).toBe("empty");

    const showedUp = presenceDashboardNumber({
      rsvps: [{ userId: "u2", name: "Bo", response: "no" }],
      rollCall: [{ userId: "u2", name: "Bo", present: true }],
      hourLogs: [],
      occurrenceDate: DATE,
      rollCallTaken: true,
    });
    expect(showedUp.data.comingTonight).toBe(1);
    expect(showedUp.status).toBe("live");
  });

  it("drops a going RSVP after an explicit absent mark", () => {
    const payload = presenceDashboardNumber({
      rsvps: [{ userId: "u1", name: "Ada", response: "going" }],
      rollCall: [{ userId: "u1", name: "Ada", present: false }],
      hourLogs: [],
      occurrenceDate: DATE,
      rollCallTaken: true,
    });
    expect(payload.data.comingTonight).toBe(0);
    expect(payload.data.userIds).toEqual([]);
    expect(payload.status).toBe("empty");
  });

  it("is setup_required with a zero count — never invents a shop from a missing workspace", () => {
    const payload = presenceDashboardNumber({
      status: "setup_required",
      message: "Choose your team to see who is coming and who was here.",
    });
    expect(payload.status).toBe("setup_required");
    expect(payload.data.comingTonight).toBe(0);
    expect(payload.data.userIds).toEqual([]);
    expect(payload.data.identityCount).toBe(0);
    expect(payload.data.parts).toEqual({ rsvpGoing: 0, present: 0, clocked: 0 });
    expect(payload.data.href).toBe("/workspace");
    expect(payload.data.ctaLabel).toBe("Choose your team");
    expect(payload.message).toMatch(/Choose your team/);
    expect(presenceDashboardComingTonight({ status: "setup_required" })).toBe(0);
  });
});
