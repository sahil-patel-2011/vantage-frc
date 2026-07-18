import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "@neondatabase/serverless";
import { computeFailurePatternsView, logPatternNote } from "./compute-failure-patterns";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "11111111-1111-4111-8111-111111111111";

function makeClient(handler: (sql: string, params: unknown[]) => { rows: unknown[]; rowCount?: number }): PoolClient {
  return {
    query: vi.fn(async (sql: string, params: unknown[] = []) => handler(sql, params)),
  } as unknown as PoolClient;
}

describe("computeFailurePatternsView", () => {
  it("returns setup_required when the user has no org membership", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) return { rows: [] };
      return { rows: [] };
    });

    const view = await computeFailurePatternsView(client, { userId: USER, requestedOrg: null });

    expect(view.status).toBe("setup_required");
    if (view.status === "setup_required") {
      expect(view.orgId).toBeNull();
      expect(view.steps.length).toBeGreaterThan(0);
    }
  });

  it("clusters FMEA + matched incident events by subsystem and flags repeat failures", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) {
        return { rows: [{ orgId: ORG, teamNumber: 254 }] };
      }
      if (sql.includes("FROM fmea_failures")) {
        return {
          rows: [
            {
              id: "fmea-1",
              subsystemName: "Intake",
              title: "Intake roller stall",
              occurredOn: "2026-02-10",
              severity: 7,
              status: "open",
            },
            {
              id: "fmea-2",
              subsystemName: "Intake",
              title: "Intake belt slip",
              occurredOn: "2026-02-01",
              severity: 5,
              status: "closed",
            },
            {
              id: "fmea-3",
              subsystemName: "Climber",
              title: "Climber ratchet slip",
              occurredOn: "2026-01-20",
              severity: 3,
              status: "closed",
            },
          ],
        };
      }
      if (sql.includes("FROM incident_reports")) {
        return {
          rows: [
            {
              id: "incident-1",
              title: "Intake motor smoking during pit repair",
              description: "Overheated during bench test",
              occurredOn: "2026-02-15",
              severityLabel: "serious",
              status: "resolved",
            },
          ],
        };
      }
      if (sql.includes("FROM robot_subsystems")) {
        return { rows: [{ name: "Intake" }, { name: "Climber" }] };
      }
      if (sql.includes("FROM failure_patterns_notes") && sql.includes("DISTINCT ON")) {
        return { rows: [] };
      }
      if (sql.includes("DISTINCT season_year")) {
        return { rows: [{ seasonYear: 2026 }] };
      }
      return { rows: [] };
    });

    const view = await computeFailurePatternsView(client, { userId: USER, requestedOrg: ORG, seasonYear: 2026 });

    expect(view.status).toBe("live");
    if (view.status !== "live") throw new Error("expected live view");

    const intake = view.clusters.find((c) => c.subsystemName === "Intake");
    expect(intake).toBeDefined();
    expect(intake?.totalCount).toBe(3);
    expect(intake?.fmeaCount).toBe(2);
    expect(intake?.incidentCount).toBe(1);
    expect(intake?.tier).toBe("watch");

    const climber = view.clusters.find((c) => c.subsystemName === "Climber");
    expect(climber?.totalCount).toBe(1);

    expect(view.summary.totalEvents).toBe(4);
    expect(view.summary.repeatClusters).toBe(1);
  });
});

describe("logPatternNote", () => {
  it("inserts a note row scoped to the org and subsystem", async () => {
    const inserted: { sql: string; params: unknown[] }[] = [];
    const client = makeClient((sql, params) => {
      if (sql.includes("INSERT INTO failure_patterns_notes")) {
        inserted.push({ sql, params });
        return { rows: [] };
      }
      return { rows: [] };
    });

    await logPatternNote(client, {
      orgId: ORG,
      userId: USER,
      seasonYear: 2026,
      subsystemName: "Intake",
      status: "acknowledged",
      note: "Ordering a stiffer belt.",
    });

    expect(inserted).toHaveLength(1);
    expect(inserted[0]?.params).toContain(ORG);
    expect(inserted[0]?.params).toContain("Intake");
    expect(inserted[0]?.params).toContain("acknowledged");
  });
});
