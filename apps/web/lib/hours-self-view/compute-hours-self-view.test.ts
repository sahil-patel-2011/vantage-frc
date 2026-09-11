import type { PoolClient } from "@neondatabase/serverless";
import { describe, expect, it, vi } from "vitest";
import { computeHoursSelfViewView, clockSelfIn, clockSelfOut } from "./compute-hours-self-view";
import { evaluateBiometricGate, summarizeHoursSelfEntries, summarizeWhoIsHere } from ".";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "11111111-1111-4111-8111-111111111111";

function makeClient(handler: (sql: string, params: unknown[]) => { rows: unknown[]; rowCount?: number }): PoolClient {
  return {
    query: vi.fn(async (sql: string, params: unknown[] = []) => handler(sql, params)),
  } as unknown as PoolClient;
}

describe("computeHoursSelfViewView", () => {
  it("returns setup_required when the user has no org membership", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) return { rows: [] };
      return { rows: [] };
    });

    const view = await computeHoursSelfViewView(client, { userId: USER, requestedOrg: null });

    expect(view.status).toBe("setup_required");
    if (view.status === "setup_required") {
      expect(view.orgId).toBeNull();
      expect(view.steps.length).toBeGreaterThan(0);
    }
  });

  it("returns a live view with own-hours summary, kiosk sessions, and the biometric gate", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) {
        return { rows: [{ orgId: ORG, teamNumber: 254 }] };
      }
      if (sql.includes("clock_out IS NULL")) {
        return {
          rows: [
            {
              userId: USER,
              displayName: "Ada",
              kind: "meeting",
              clockIn: "2026-01-12T18:00:00.000Z",
            },
          ],
        };
      }
      if (sql.includes("FROM hour_logs")) {
        return {
          rows: [
            {
              id: "e1",
              kind: "build",
              clockIn: "2026-01-10T18:00:00.000Z",
              clockOut: "2026-01-10T21:00:00.000Z",
              note: "Drivetrain assembly",
            },
            {
              id: "e2",
              kind: "meeting",
              clockIn: "2026-01-12T18:00:00.000Z",
              clockOut: null,
              note: "",
            },
          ],
        };
      }
      if (sql.includes("FROM hours_self_view_kiosk_sessions")) {
        return {
          rows: [
            {
              id: "k1",
              deviceLabel: "Shop entrance tablet",
              isLocked: true,
              lastActiveAt: "2026-01-12T18:00:00.000Z",
              createdAt: "2026-01-01T00:00:00.000Z",
            },
          ],
        };
      }
      if (sql.includes("FROM hours_self_view_biometric_consents")) {
        return {
          rows: [
            {
              isMinor: true,
              consentStatus: "granted",
              guardianName: "Pat Guardian",
              recordedAt: "2026-01-02T00:00:00.000Z",
            },
          ],
        };
      }
      return { rows: [] };
    });

    const view = await computeHoursSelfViewView(client, { userId: USER, requestedOrg: ORG });

    expect(view.status).toBe("live");
    if (view.status !== "live") throw new Error("expected live view");
    expect(view.orgId).toBe(ORG);
    expect(view.teamNumber).toBe(254);
    expect(view.entries).toHaveLength(2);
    // 3 closed hours + 1 open (0 minutes) session.
    expect(view.summary.totalHours).toBe(3);
    expect(view.summary.openEntry?.id).toBe("e2");
    expect(view.kioskSessions).toHaveLength(1);
    expect(view.kioskSessions[0]?.isLocked).toBe(true);
    expect(view.presentNow).toHaveLength(1);
    expect(view.presentNow[0]?.displayName).toBe("Ada");
    expect(view.presentNow[0]?.kind).toBe("meeting");
    expect(view.biometricConsent?.status).toBe("granted");
    expect(view.biometricGate.allowed).toBe(true);
  });
});

describe("summarizeHoursSelfEntries", () => {
  it("aggregates minutes by kind and surfaces the single open entry", () => {
    const summary = summarizeHoursSelfEntries([
      { id: "a", kind: "build", clockIn: "2026-01-01T00:00:00.000Z", clockOut: "2026-01-01T02:00:00.000Z", minutes: 120, note: "" },
      { id: "b", kind: "build", clockIn: "2026-01-02T00:00:00.000Z", clockOut: "2026-01-02T01:00:00.000Z", minutes: 60, note: "" },
      { id: "c", kind: "meeting", clockIn: "2026-01-03T00:00:00.000Z", clockOut: null, minutes: 0, note: "" },
    ]);

    expect(summary.totalEntries).toBe(3);
    expect(summary.totalHours).toBe(3);
    expect(summary.openEntry?.id).toBe("c");
    expect(summary.byKind.find((row) => row.kind === "build")?.hours).toBe(3);
  });
});

describe("summarizeWhoIsHere", () => {
  it("computes open minutes from real clock-ins and never invents names", () => {
    const present = summarizeWhoIsHere(
      [
        { userId: "b", displayName: "  ", kind: "build", clockIn: "2026-01-12T19:00:00.000Z" },
        { userId: "a", displayName: "Ada", kind: "meeting", clockIn: "2026-01-12T18:00:00.000Z" },
      ],
      "2026-01-12T20:00:00.000Z",
    );

    expect(present.map((row) => row.userId)).toEqual(["a", "b"]);
    expect(present[0]).toMatchObject({ displayName: "Ada", minutesOpen: 120 });
    expect(present[1]).toMatchObject({ displayName: "Member", minutesOpen: 60 });
  });
});

describe("evaluateBiometricGate", () => {
  it("blocks minors with no consent record on file", () => {
    expect(evaluateBiometricGate(null).allowed).toBe(false);
  });

  it("blocks minors pending guardian consent", () => {
    const gate = evaluateBiometricGate({ isMinor: true, status: "pending", guardianName: null, recordedAt: null });
    expect(gate.allowed).toBe(false);
  });

  it("allows minors with granted guardian consent", () => {
    const gate = evaluateBiometricGate({ isMinor: true, status: "granted", guardianName: "Pat", recordedAt: "2026-01-01" });
    expect(gate.allowed).toBe(true);
  });

  it("allows adults unconditionally", () => {
    const gate = evaluateBiometricGate({ isMinor: false, status: "pending", guardianName: null, recordedAt: null });
    expect(gate.allowed).toBe(true);
  });
});

describe("clockSelfIn / clockSelfOut", () => {
  it("inserts a shop session when none is open", async () => {
    const queries: string[] = [];
    const client = makeClient((sql) => {
      queries.push(sql);
      if (sql.includes("clock_out IS NULL") && sql.includes("SELECT")) {
        return { rows: [], rowCount: 0 };
      }
      return { rows: [], rowCount: 1 };
    });
    await clockSelfIn(client, { orgId: ORG, userId: USER, kind: "build" });
    expect(queries.some((sql) => sql.includes("INSERT INTO hour_logs"))).toBe(true);
  });

  it("refuses a second clock-in while a session is open", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("SELECT 1 FROM hour_logs")) return { rows: [{}], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
    await expect(clockSelfIn(client, { orgId: ORG, userId: USER })).rejects.toThrow(
      /already clocked in/i,
    );
  });

  it("closes the open session on clock-out", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("UPDATE hour_logs")) return { rows: [], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
    await clockSelfOut(client, { orgId: ORG, userId: USER });
  });
});
