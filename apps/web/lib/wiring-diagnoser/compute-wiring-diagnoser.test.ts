import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "@neondatabase/serverless";
import { computeWiringDiagnoserView, logCheck } from "./compute-wiring-diagnoser";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "11111111-1111-4111-8111-111111111111";

function makeClient(handler: (sql: string, params: unknown[]) => { rows: unknown[]; rowCount?: number }): PoolClient {
  return {
    query: vi.fn(async (sql: string, params: unknown[] = []) => handler(sql, params)),
  } as unknown as PoolClient;
}

describe("computeWiringDiagnoserView", () => {
  it("returns setup_required when the user has no org membership", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) return { rows: [] };
      return { rows: [] };
    });

    const view = await computeWiringDiagnoserView(client, { userId: USER, requestedOrg: null });

    expect(view.status).toBe("setup_required");
    if (view.status === "setup_required") {
      expect(view.orgId).toBeNull();
      expect(view.steps.length).toBeGreaterThan(0);
    }
  });

  it("returns a live view built from stored wiring checks", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) {
        return { rows: [{ orgId: ORG, teamNumber: 254 }] };
      }
      if (sql.includes("FROM wiring_diagnoser_checks") && sql.includes("SELECT id")) {
        return {
          rows: [
            {
              id: "check-1",
              seasonYear: 2026,
              boardName: "Drivetrain PDH",
              photoUrl: null,
              expectedCircuits: [
                { channel: 0, deviceName: "Front Left Drive", wireGauge: "12", breakerAmps: 40, expectedCurrentDrawAmps: 30 },
              ],
              observedCircuits: [
                { channel: 0, deviceName: "Front Right Drive", wireGauge: "12", breakerAmps: 40 },
              ],
              flags: [
                {
                  channel: 0,
                  type: "miswire",
                  severity: "critical",
                  message: "Channel 0 mismatch",
                },
              ],
              riskScore: "0.833",
              summary: "1 critical and 0 warning issue(s) found across 1 circuit(s).",
              createdAt: "2026-02-01T00:00:00.000Z",
              updatedAt: "2026-02-01T00:00:00.000Z",
            },
          ],
        };
      }
      if (sql.includes("DISTINCT season_year")) {
        return { rows: [{ seasonYear: 2026 }] };
      }
      return { rows: [] };
    });

    const view = await computeWiringDiagnoserView(client, { userId: USER, requestedOrg: ORG, seasonYear: 2026 });

    expect(view.status).toBe("live");
    if (view.status !== "live") throw new Error("expected live view");
    expect(view.checks).toHaveLength(1);
    expect(view.checks[0]?.flags).toHaveLength(1);
    expect(view.checks[0]?.flags[0]?.type).toBe("miswire");
    expect(view.checks[0]?.riskScore).toBeCloseTo(0.833);
  });
});

describe("logCheck", () => {
  it("computes and persists a deterministic diagnosis grounded in expected vs observed circuits", async () => {
    const inserted: { sql: string; params: unknown[] }[] = [];
    const client = makeClient((sql, params) => {
      if (sql.includes("INSERT INTO ai_usage_events")) {
        inserted.push({ sql, params });
        return { rows: [] };
      }
      if (sql.includes("INSERT INTO wiring_diagnoser_checks")) {
        inserted.push({ sql, params });
        return { rows: [] };
      }
      return { rows: [] };
    });

    await logCheck(client, {
      orgId: ORG,
      userId: USER,
      seasonYear: 2026,
      boardName: "Drivetrain PDH",
      photoUrl: null,
      expectedCircuits: [
        { channel: 0, deviceName: "Front Left Drive", wireGauge: "12", breakerAmps: 40, expectedCurrentDrawAmps: 30 },
        { channel: 1, deviceName: "Intake Motor", wireGauge: "18", breakerAmps: 30, expectedCurrentDrawAmps: 10 },
      ],
      observedCircuits: [
        // Channel 0 miswired: different device name.
        { channel: 0, deviceName: "Front Right Drive", wireGauge: "12", breakerAmps: 40 },
        // Channel 1 breaker (30A) exceeds 18 AWG wire's rated ampacity (14A) -> wire-undersized fault.
        { channel: 1, deviceName: "Intake Motor", wireGauge: "18", breakerAmps: 30 },
      ],
    });

    const checkInsert = inserted.find((entry) => entry.sql.includes("INSERT INTO wiring_diagnoser_checks"));
    expect(checkInsert).toBeDefined();
    const flagsJson = String(checkInsert?.params[6]);
    expect(flagsJson).toContain("miswire");
    expect(flagsJson).toContain("wire_undersized_for_breaker");

    const usageInsert = inserted.find((entry) => entry.sql.includes("INSERT INTO ai_usage_events"));
    expect(usageInsert).toBeDefined();
  });
});
