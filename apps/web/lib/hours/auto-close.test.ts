import { describe, expect, it } from "vitest";
import {
  DEFAULT_AUTO_CLOSE_AFTER_HOURS,
  DEFAULT_AUTO_CLOSE_CREDIT_HOURS,
  MIN_CREDIT_HOURS,
  describeAutoClosePlan,
  normalizeAutoClosePolicy,
  planAutoClose,
  type OpenSession,
} from "./auto-close";

const NOW = Date.UTC(2026, 1, 14, 18, 0, 0); // 2026-02-14T18:00:00Z
const hoursAgo = (hours: number) => new Date(NOW - hours * 3_600_000).toISOString();

function session(id: string, hours: number, name = "Maya"): OpenSession {
  return { id, userId: `user-${id}`, userName: name, clockIn: hoursAgo(hours) };
}

const policy = { afterHours: 12, creditHours: 4 };

describe("normalizeAutoClosePolicy", () => {
  it("falls back to the documented defaults for missing values", () => {
    expect(normalizeAutoClosePolicy({ afterHours: null, creditHours: null })).toEqual({
      afterHours: DEFAULT_AUTO_CLOSE_AFTER_HOURS,
      creditHours: DEFAULT_AUTO_CLOSE_CREDIT_HOURS,
    });
  });

  it("clamps to the range the migration CHECK constraints allow", () => {
    expect(normalizeAutoClosePolicy({ afterHours: 5000, creditHours: 99 })).toEqual({
      afterHours: 168,
      creditHours: 24,
    });
  });

  it("rejects nonsense rather than propagating NaN", () => {
    expect(normalizeAutoClosePolicy({ afterHours: 0, creditHours: -3 })).toEqual({
      afterHours: DEFAULT_AUTO_CLOSE_AFTER_HOURS,
      creditHours: DEFAULT_AUTO_CLOSE_CREDIT_HOURS,
    });
  });

  it("accepts a zero credit policy (credit nothing, flag everything)", () => {
    expect(normalizeAutoClosePolicy({ afterHours: 8, creditHours: 0 })).toEqual({
      afterHours: 8,
      creditHours: 0,
    });
  });
});

describe("planAutoClose", () => {
  it("leaves sessions inside the cutoff alone", () => {
    const plan = planAutoClose({ sessions: [session("a", 3), session("b", 11.9)], policy, now: NOW });
    expect(plan.closures).toHaveLength(0);
    expect(plan.keptOpen).toBe(2);
  });

  it("closes a session that has been open past the cutoff", () => {
    const plan = planAutoClose({ sessions: [session("a", 18)], policy, now: NOW });
    expect(plan.closures).toHaveLength(1);
    expect(plan.keptOpen).toBe(0);
    expect(plan.closures[0]!.id).toBe("a");
  });

  it("never credits the full elapsed time — the excess is withheld for review", () => {
    const plan = planAutoClose({ sessions: [session("a", 18)], policy, now: NOW });
    const closure = plan.closures[0]!;
    expect(closure.openHours).toBe(18);
    expect(closure.creditedHours).toBe(4);
    expect(closure.withheldHours).toBe(14);
    // clock_out is clock_in + credited, not now.
    expect(new Date(closure.clockOut).getTime()).toBe(new Date(closure.clockIn).getTime() + 4 * 3_600_000);
    expect(new Date(closure.clockOut).getTime()).toBeLessThan(NOW);
  });

  it("keeps clock_out strictly after clock_in even at a zero-credit policy", () => {
    const plan = planAutoClose({
      sessions: [session("a", 30)],
      policy: { afterHours: 12, creditHours: 0 },
      now: NOW,
    });
    const closure = plan.closures[0]!;
    expect(closure.creditedHours).toBeGreaterThan(0);
    expect(closure.creditedHours).toBeCloseTo(Math.round(MIN_CREDIT_HOURS * 100) / 100, 5);
    expect(new Date(closure.clockOut).getTime()).toBeGreaterThan(new Date(closure.clockIn).getTime());
  });

  it("never credits more than the session actually ran", () => {
    // Cutoff 2h, credit cap 4h, session open 3h → credit the real 3h, not 4h.
    const plan = planAutoClose({
      sessions: [session("a", 3)],
      policy: { afterHours: 2, creditHours: 4 },
      now: NOW,
    });
    expect(plan.closures[0]!.creditedHours).toBe(3);
    expect(plan.closures[0]!.withheldHours).toBe(0);
  });

  it("writes a reason that names the cutoff and the capped credit", () => {
    const reason = planAutoClose({ sessions: [session("a", 20)], policy, now: NOW }).closures[0]!.reason;
    expect(reason).toContain("Forgot to sign out");
    expect(reason).toContain("cutoff 12h");
    expect(reason).toContain("Credited 4h");
    expect(reason).toContain("mentor");
  });

  it("skips unreadable or future clock-ins instead of closing them", () => {
    const plan = planAutoClose({
      sessions: [
        { id: "bad", userId: "u1", userName: "X", clockIn: "not-a-date" },
        { id: "future", userId: "u2", userName: "Y", clockIn: new Date(NOW + 3_600_000).toISOString() },
      ],
      policy,
      now: NOW,
    });
    expect(plan.closures).toHaveLength(0);
    expect(plan.keptOpen).toBe(2);
  });

  it("is deterministic and order-independent", () => {
    const sessions = [session("c", 40), session("a", 20), session("b", 30)];
    const first = planAutoClose({ sessions, policy, now: NOW });
    const second = planAutoClose({ sessions: [...sessions].reverse(), policy, now: NOW });
    expect(first).toEqual(second);
    expect(first.closures.map((row) => row.id)).toEqual(["c", "b", "a"]);
  });

  it("does not mutate the sessions it was given", () => {
    const sessions = [session("c", 40), session("a", 20)];
    const snapshot = JSON.parse(JSON.stringify(sessions));
    planAutoClose({ sessions, policy, now: NOW });
    expect(sessions).toEqual(snapshot);
  });
});

describe("describeAutoClosePlan", () => {
  it("says nothing was found when nothing is stale", () => {
    const plan = planAutoClose({ sessions: [session("a", 2)], policy, now: NOW });
    expect(describeAutoClosePlan(plan)).toContain("No forgotten sessions");
  });

  it("reports the count, names, and withheld hours", () => {
    const plan = planAutoClose(
      { sessions: [session("a", 18, "Maya"), session("b", 20, "Ravi")], policy, now: NOW },
    );
    const text = describeAutoClosePlan(plan);
    expect(text).toContain("Flagged 2 forgotten sessions");
    expect(text).toContain("Ravi");
    expect(text).toContain("Maya");
    expect(text).toContain("30h withheld");
  });
});
