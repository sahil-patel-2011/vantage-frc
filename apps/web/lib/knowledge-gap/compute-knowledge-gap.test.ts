import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "@neondatabase/serverless";
import { computeKnowledgeGapView, runKnowledgeGapScan } from "./compute-knowledge-gap";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "11111111-1111-4111-8111-111111111111";

function makeClient(handler: (sql: string, params: unknown[]) => { rows: unknown[]; rowCount?: number }): PoolClient {
  return {
    query: vi.fn(async (sql: string, params: unknown[] = []) => handler(sql, params)),
  } as unknown as PoolClient;
}

describe("computeKnowledgeGapView", () => {
  it("returns setup_required when the user has no org membership", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) return { rows: [] };
      return { rows: [] };
    });

    const view = await computeKnowledgeGapView(client, { userId: USER, requestedOrg: null });

    expect(view.status).toBe("setup_required");
    if (view.status === "setup_required") {
      expect(view.orgId).toBeNull();
      expect(view.steps.length).toBeGreaterThan(0);
    }
  });
});

describe("runKnowledgeGapScan", () => {
  it("diffs subsystems, decisions, and scouted events against the wiki and persists undocumented gaps", async () => {
    const inserted: { sql: string; params: unknown[] }[] = [];
    let scanRowCount = 0;

    const client = makeClient((sql, params) => {
      if (sql.includes("FROM memberships")) {
        return { rows: [{ orgId: ORG, teamNumber: 254 }] };
      }
      if (sql.includes("FROM robot_subsystems")) {
        return {
          rows: [
            { id: "sub-climber", name: "Climber", category: "climber", seasonYear: 2026 },
            { id: "sub-shooter", name: "Shooter", category: "shooter", seasonYear: 2026 },
          ],
        };
      }
      if (sql.includes("FROM decision_records") && sql.includes("SELECT id, title")) {
        return { rows: [{ id: "dec-1", title: "Switch to swerve drive", seasonYear: 2026 }] };
      }
      if (sql.includes("FROM match_scout_entries")) {
        return { rows: [{ eventKey: "2026nyrr", name: "New York Regional", seasonYear: 2026 }] };
      }
      if (sql.includes("FROM knowledge_pages") && sql.includes("SELECT id, title, body")) {
        return {
          rows: [
            {
              id: "page-1",
              title: "Climber subsystem notes",
              body: "How the climber works.",
              tags: [],
              seasonYear: 2026,
            },
          ],
        };
      }
      if (sql.includes("INSERT INTO ai_usage_events")) {
        inserted.push({ sql, params });
        return { rows: [] };
      }
      if (sql.includes("INSERT INTO knowledge_gap_scans")) {
        inserted.push({ sql, params });
        scanRowCount += 1;
        return { rows: [{ id: "scan-1", createdAt: "2026-02-01T00:00:00.000Z" }] };
      }
      if (sql.includes("INSERT INTO knowledge_gap_items")) {
        inserted.push({ sql, params });
        return { rows: [] };
      }
      if (sql.includes("DISTINCT season_year AS \"seasonYear\" FROM knowledge_gap_scans")) {
        return { rows: [{ seasonYear: 2026 }] };
      }
      if (sql.includes("FROM knowledge_gap_scans") && sql.includes("SELECT id, season_year")) {
        // Reflect the scan we just wrote (only meaningful once inserted).
        if (scanRowCount === 0) return { rows: [] };
        return {
          rows: [
            {
              id: "scan-1",
              seasonYear: 2026,
              subsystemCount: 2,
              decisionCount: 1,
              eventCount: 1,
              pageCount: 1,
              gapCount: 3,
              coverageScore: "0.2500",
              summary: "3 of 4 tracked subject(s) have no wiki coverage (25% documented).",
              createdAt: "2026-02-01T00:00:00.000Z",
            },
          ],
        };
      }
      if (sql.includes("FROM knowledge_gap_items") && sql.includes("SELECT id, subject_kind")) {
        return {
          rows: [
            {
              id: "item-shooter",
              subjectKind: "subsystem",
              subjectRef: "Shooter",
              subjectId: "sub-shooter",
              seasonYear: 2026,
              reason: 'No wiki page mentions the "Shooter" (shooter) subsystem.',
              suggestedTemplate: "subsystem",
              status: "open",
              draftPageId: null,
              createdAt: "2026-02-01T00:00:00.000Z",
            },
            {
              id: "item-decision",
              subjectKind: "decision",
              subjectRef: "Switch to swerve drive",
              subjectId: "dec-1",
              seasonYear: 2026,
              reason: 'Decision "Switch to swerve drive" has no linked wiki page explaining it to future members.',
              suggestedTemplate: "blank",
              status: "open",
              draftPageId: null,
              createdAt: "2026-02-01T00:00:00.000Z",
            },
            {
              id: "item-event",
              subjectKind: "event",
              subjectRef: "New York Regional",
              subjectId: "2026nyrr",
              seasonYear: 2026,
              reason: 'Team has scouted matches at "New York Regional" but has no season-handoff notes for it.',
              suggestedTemplate: "season_handoff",
              status: "open",
              draftPageId: null,
              createdAt: "2026-02-01T00:00:00.000Z",
            },
          ],
        };
      }
      return { rows: [] };
    });

    const view = await runKnowledgeGapScan(client, { orgId: ORG, userId: USER, seasonYear: 2026 });

    expect(view.status).toBe("live");
    if (view.status !== "live") throw new Error("expected live view");
    expect(view.scan?.gapCount).toBe(3);
    expect(view.scan?.coverageScore).toBeCloseTo(0.25);
    expect(view.items).toHaveLength(3);
    expect(view.items.map((item) => item.subjectRef).sort()).toEqual([
      "New York Regional",
      "Shooter",
      "Switch to swerve drive",
    ]);
    // Climber is covered by the existing wiki page, so it must not appear as a gap.
    expect(view.items.some((item) => item.subjectRef === "Climber")).toBe(false);

    const scanInsert = inserted.find((entry) => entry.sql.includes("INSERT INTO knowledge_gap_scans"));
    expect(scanInsert).toBeDefined();
    expect(scanInsert?.params).toContain(3); // gap_count

    const usageInsert = inserted.find((entry) => entry.sql.includes("INSERT INTO ai_usage_events"));
    expect(usageInsert).toBeDefined();

    const itemInserts = inserted.filter((entry) => entry.sql.includes("INSERT INTO knowledge_gap_items"));
    expect(itemInserts).toHaveLength(3);
  });
});
