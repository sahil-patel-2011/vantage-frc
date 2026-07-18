import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "@neondatabase/serverless";
import { computeIncidentHeatmapView } from "./compute-incident-heatmap";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "11111111-1111-4111-8111-111111111111";

function makeClient(handler: (sql: string, params: unknown[]) => { rows: unknown[]; rowCount?: number }): PoolClient {
  return {
    query: vi.fn(async (sql: string, params: unknown[] = []) => handler(sql, params)),
  } as unknown as PoolClient;
}

describe("computeIncidentHeatmapView", () => {
  it("returns setup_required when the user has no org membership", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) return { rows: [] };
      return { rows: [] };
    });

    const view = await computeIncidentHeatmapView(client, { userId: USER, requestedOrg: null });

    expect(view.status).toBe("setup_required");
    if (view.status === "setup_required") {
      expect(view.orgId).toBeNull();
      expect(view.steps.length).toBeGreaterThan(0);
    }
  });

  it("returns a live view with a subsystem/time heatmap summary built from logged incidents", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) {
        return { rows: [{ orgId: ORG, teamNumber: 254 }] };
      }
      if (sql.includes("FROM incident_heatmap_incidents") && sql.includes("SELECT id")) {
        return {
          rows: [
            {
              id: "inc-1",
              seasonYear: 2026,
              subsystem: "Intake",
              context: "match",
              eventKey: "2026casj",
              matchKey: "2026casj_qm12",
              title: "Intake jammed",
              notes: "Roller stall",
              occurredAt: "2026-02-02T10:00:00.000Z",
            },
            {
              id: "inc-2",
              seasonYear: 2026,
              subsystem: "Intake",
              context: "pit",
              eventKey: "2026casj",
              matchKey: null,
              title: "Intake belt slipped",
              notes: null,
              occurredAt: "2026-02-02T12:00:00.000Z",
            },
            {
              id: "inc-3",
              seasonYear: 2026,
              subsystem: "Drivetrain",
              context: "practice",
              eventKey: null,
              matchKey: null,
              title: "Wheel wobble",
              notes: null,
              occurredAt: "2026-02-09T09:00:00.000Z",
            },
          ],
        };
      }
      if (sql.includes("DISTINCT season_year")) {
        return { rows: [{ seasonYear: 2026 }] };
      }
      return { rows: [] };
    });

    const view = await computeIncidentHeatmapView(client, { userId: USER, requestedOrg: ORG, seasonYear: 2026 });

    expect(view.status).toBe("live");
    if (view.status !== "live") throw new Error("expected live view");
    expect(view.incidents).toHaveLength(3);
    expect(view.summary.totalIncidents).toBe(3);
    expect(view.summary.hottestSubsystem).toBe("Intake");
    expect(view.summary.bySubsystem[0]).toMatchObject({ subsystem: "Intake", count: 2 });
    expect(view.summary.byContext.some((c) => c.context === "match")).toBe(true);
    // Two incidents in the same ISO week should collapse into one heatmap cell.
    const intakeCells = view.summary.cells.filter((cell) => cell.subsystem === "Intake");
    expect(intakeCells).toHaveLength(1);
    expect(intakeCells[0]?.count).toBe(2);
    expect(view.summary.buckets.length).toBeGreaterThan(0);
  });
});
