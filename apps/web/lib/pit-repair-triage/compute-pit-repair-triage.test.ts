import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "@neondatabase/serverless";
import { computePitRepairTriageView, logFailure } from "./compute-pit-repair-triage";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "11111111-1111-4111-8111-111111111111";
const FMEA_ID = "22222222-2222-4222-8222-222222222222";
const INVENTORY_ID = "33333333-3333-4333-8333-333333333333";

function makeClient(handler: (sql: string, params: unknown[]) => { rows: unknown[]; rowCount?: number }): PoolClient {
  return {
    query: vi.fn(async (sql: string, params: unknown[] = []) => handler(sql, params)),
  } as unknown as PoolClient;
}

describe("computePitRepairTriageView", () => {
  it("returns setup_required when the user has no org membership", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) return { rows: [] };
      return { rows: [] };
    });

    const view = await computePitRepairTriageView(client, { userId: USER, requestedOrg: null });

    expect(view.status).toBe("setup_required");
    if (view.status === "setup_required") {
      expect(view.orgId).toBeNull();
      expect(view.steps.length).toBeGreaterThan(0);
    }
  });

  it("returns a live view built from triage reports, FMEA history, and spare candidates", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) {
        return { rows: [{ orgId: ORG, teamNumber: 254 }] };
      }
      if (sql.includes("FROM pit_repair_triage_reports") && sql.includes("SELECT id")) {
        return {
          rows: [
            {
              id: "report-1",
              seasonYear: 2026,
              subsystemName: "Intake",
              title: "Intake roller jammed",
              symptomNote: "Roller stalls under load, motor stalls out",
              photoUrl: null,
              relatedFmeaFailureId: FMEA_ID,
              matchedInventoryItemId: INVENTORY_ID,
              minutesUntilNextMatch: 8,
              severity: 6,
              priorFailureCount: 3,
              sparesAvailable: "2.00",
              decision: "swap",
              confidence: "0.71",
              rationale: "Only 8 min until the next match — swap it.",
              prestageRecommended: true,
              status: "open",
              createdAt: "2026-02-01T00:00:00.000Z",
              updatedAt: "2026-02-01T00:00:00.000Z",
            },
          ],
        };
      }
      if (sql.includes("FROM fmea_failures")) {
        return {
          rows: [
            {
              id: FMEA_ID,
              title: "Intake roller stall",
              subsystemName: "Intake",
              occurredAt: "2026-01-15",
              severity: 6,
              occurrence: 4,
              detection: 3,
              status: "open",
            },
          ],
        };
      }
      if (sql.includes("FROM inventory_items")) {
        return {
          rows: [
            { id: INVENTORY_ID, name: "Intake roller motor", category: "motor", quantity: "2.00", subsystem: "Intake" },
          ],
        };
      }
      if (sql.includes("DISTINCT season_year")) {
        return { rows: [{ seasonYear: 2026 }] };
      }
      return { rows: [] };
    });

    const view = await computePitRepairTriageView(client, { userId: USER, requestedOrg: ORG, seasonYear: 2026 });

    expect(view.status).toBe("live");
    if (view.status !== "live") throw new Error("expected live view");
    expect(view.reports).toHaveLength(1);
    expect(view.reports[0]?.decision).toBe("swap");
    expect(view.fmeaHistory).toHaveLength(1);
    expect(view.spareCandidates).toHaveLength(1);
    expect(view.spareCandidates[0]?.quantity).toBe(2);
  });
});

describe("logFailure", () => {
  it("computes and persists a deterministic fix-vs-swap decision grounded in history/spares/time", async () => {
    const inserted: { sql: string; params: unknown[] }[] = [];
    const client = makeClient((sql, params) => {
      if (sql.includes("count(*)::text AS count FROM fmea_failures")) {
        return { rows: [{ count: "3" }] };
      }
      if (sql.includes("SELECT severity FROM fmea_failures")) {
        return { rows: [{ severity: 6 }] };
      }
      if (sql.includes("SELECT quantity::text AS quantity FROM inventory_items")) {
        return { rows: [{ quantity: "2.00" }] };
      }
      if (sql.includes("INSERT INTO ai_usage_events")) {
        inserted.push({ sql, params });
        return { rows: [] };
      }
      if (sql.includes("INSERT INTO pit_repair_triage_reports")) {
        inserted.push({ sql, params });
        return { rows: [] };
      }
      return { rows: [] };
    });

    await logFailure(client, {
      orgId: ORG,
      userId: USER,
      seasonYear: 2026,
      subsystemName: "Intake",
      title: "Intake roller jammed again",
      symptomNote: "Roller stalls under load",
      photoUrl: null,
      minutesUntilNextMatch: 8,
      relatedFmeaFailureId: FMEA_ID,
      matchedInventoryItemId: INVENTORY_ID,
    });

    const reportInsert = inserted.find((entry) => entry.sql.includes("INSERT INTO pit_repair_triage_reports"));
    expect(reportInsert).toBeDefined();
    // Spares on hand + only 8 min until next match -> not enough time to fix -> swap.
    expect(reportInsert?.params).toContain("swap");
    expect(reportInsert?.params).toContain(true); // prestageRecommended

    const usageInsert = inserted.find((entry) => entry.sql.includes("INSERT INTO ai_usage_events"));
    expect(usageInsert).toBeDefined();
  });
});
