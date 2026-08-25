import { describe, expect, it } from "vitest";
import { noRecordMembers, presenceDiscrepancies, reconcilePresence } from "./reconcile";

const DATE = "2026-02-10";

describe("reconcilePresence", () => {
  it("returns nothing for a member with no signal at all", () => {
    const rows = reconcilePresence({ rsvps: [], rollCall: [], hourLogs: [], occurrenceDate: DATE });
    expect(rows).toEqual([]);
  });

  it("never infers attendance from an RSVP", () => {
    const rows = reconcilePresence({
      rsvps: [{ userId: "u1", name: "Ada", response: "going" }],
      rollCall: [],
      hourLogs: [],
      occurrenceDate: DATE,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].rsvp).toBe("going");
    expect(rows[0].attended).toBeNull();
    expect(rows[0].minutes).toBeNull();
    // No roll call exists, so nothing contradicts them.
    expect(rows[0].discrepancy).toBeNull();
  });

  it("never infers an RSVP from attendance", () => {
    const rows = reconcilePresence({
      rsvps: [],
      rollCall: [{ userId: "u1", name: "Ada", present: true }],
      hourLogs: [],
      occurrenceDate: DATE,
    });
    expect(rows[0].rsvp).toBeNull();
    expect(rows[0].attended).toBe(true);
    expect(rows[0].discrepancy).toBe("came_without_rsvp");
  });

  it("flags said_going_absent only when a roll call actually exists", () => {
    const input = {
      rsvps: [{ userId: "u1", name: "Ada", response: "going" as const }],
      hourLogs: [],
      occurrenceDate: DATE,
    };
    const noRollCall = reconcilePresence({ ...input, rollCall: [], rollCallTaken: false });
    expect(noRollCall[0].discrepancy).toBeNull();

    const withRollCall = reconcilePresence({
      ...input,
      rollCall: [{ userId: "u2", name: "Grace", present: true }],
      rollCallTaken: true,
    });
    const ada = withRollCall.find((row) => row.userId === "u1");
    expect(ada?.discrepancy).toBe("said_going_absent");
    // Still "no record", never flipped to absent.
    expect(ada?.attended).toBeNull();
  });

  it("only sets attended false from an explicit absent mark", () => {
    const rows = reconcilePresence({
      rsvps: [],
      rollCall: [{ userId: "u1", name: "Ada", present: false }],
      hourLogs: [],
      occurrenceDate: DATE,
    });
    expect(rows[0].attended).toBe(false);
  });

  it("lets a present mark win over a duplicate absent mark", () => {
    const rows = reconcilePresence({
      rsvps: [],
      rollCall: [
        { userId: "u1", name: "Ada", present: false },
        { userId: "u1", name: "Ada", present: true },
      ],
      hourLogs: [],
      occurrenceDate: DATE,
    });
    expect(rows[0].attended).toBe(true);
  });

  it("sums linked hour logs and flags clocked_no_roll_call", () => {
    const rows = reconcilePresence({
      rsvps: [],
      rollCall: [{ userId: "u2", name: "Grace", present: true }],
      hourLogs: [
        { userId: "u1", name: "Ada", hourLogId: "h1", minutes: 90 },
        { userId: "u1", name: "Ada", hourLogId: "h2", minutes: 30.5, open: true },
      ],
      occurrenceDate: DATE,
      rollCallTaken: true,
    });
    const ada = rows.find((row) => row.userId === "u1");
    expect(ada?.minutes).toBe(120.5);
    expect(ada?.hourLogIds).toEqual(["h1", "h2"]);
    expect(ada?.hasOpenSession).toBe(true);
    expect(ada?.discrepancy).toBe("clocked_no_roll_call");
  });

  it("does not flag clocked hours when nobody took roll", () => {
    const rows = reconcilePresence({
      rsvps: [],
      rollCall: [],
      hourLogs: [{ userId: "u1", name: "Ada", hourLogId: "h1", minutes: 60 }],
      occurrenceDate: DATE,
      rollCallTaken: false,
    });
    expect(rows[0].discrepancy).toBeNull();
  });

  it("prefers an occurrence RSVP over a standing series RSVP", () => {
    const rows = reconcilePresence({
      rsvps: [
        { userId: "u1", name: "Ada", response: "going", scope: "series" },
        { userId: "u1", name: "Ada", response: "no", scope: "occurrence" },
      ],
      rollCall: [],
      hourLogs: [],
      occurrenceDate: DATE,
    });
    expect(rows[0].rsvp).toBe("no");
    expect(rows[0].rsvpScope).toBe("occurrence");
  });

  it("sorts flagged rows first, then by name", () => {
    const rows = reconcilePresence({
      rsvps: [
        { userId: "u1", name: "Zoe", response: "going" },
        { userId: "u3", name: "Ada", response: "maybe" },
      ],
      rollCall: [
        { userId: "u3", name: "Ada", present: true },
        { userId: "u2", name: "Bo", present: true },
      ],
      hourLogs: [],
      occurrenceDate: DATE,
      rollCallTaken: true,
    });
    expect(rows.map((row) => row.userId)).toEqual(["u2", "u1", "u3"]);
    expect(presenceDiscrepancies(rows).map((row) => row.discrepancy)).toEqual([
      "came_without_rsvp",
      "said_going_absent",
    ]);
  });

  it("stamps the occurrence date on every row so a series does not collapse", () => {
    const rows = reconcilePresence({
      rsvps: [{ userId: "u1", name: "Ada", response: "going" }],
      rollCall: [],
      hourLogs: [],
      occurrenceDate: "2026-03-03",
    });
    expect(rows[0].occurrenceDate).toBe("2026-03-03");
  });
});

describe("noRecordMembers", () => {
  it("lists roster members with no signal, and never calls them absent", () => {
    const rows = reconcilePresence({
      rsvps: [{ userId: "u1", name: "Ada", response: "going" }],
      rollCall: [],
      hourLogs: [],
      occurrenceDate: DATE,
    });
    const missing = noRecordMembers(
      [
        { userId: "u1", name: "Ada" },
        { userId: "u2", name: "Bo" },
        { userId: "u3", name: "Cy" },
      ],
      rows,
    );
    expect(missing.map((member) => member.userId)).toEqual(["u2", "u3"]);
  });
});
