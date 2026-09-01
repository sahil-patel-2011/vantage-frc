import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "@neondatabase/serverless";
import { computeRetroView, generatePostmortem } from "./compute-retro";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "11111111-1111-4111-8111-111111111111";
const SEASON = 2026;

function makeClient(handler: (sql: string, params: unknown[]) => { rows: unknown[]; rowCount?: number }): PoolClient {
  return {
    query: vi.fn(async (sql: string, params: unknown[] = []) => handler(sql, params)),
  } as unknown as PoolClient;
}

describe("computeRetroView", () => {
  it("returns setup_required when the user has no org membership", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) return { rows: [] };
      return { rows: [] };
    });

    const view = await computeRetroView(client, { userId: USER, requestedOrg: null, seasonYear: SEASON });

    expect(view.status).toBe("setup_required");
    if (view.status === "setup_required") {
      expect(view.orgId).toBeNull();
      expect(view.seasonYear).toBe(SEASON);
      expect(view.steps.length).toBeGreaterThan(0);
    }
  });

  it("returns a live view with sessions, grouped items, action items, and postmortems", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) {
        return { rows: [{ orgId: ORG, teamNumber: 254 }] };
      }
      if (sql.includes("FROM retro_sessions")) {
        return {
          rows: [
            {
              id: "s1",
              title: "Week 3 retro",
              periodLabel: "Jan 12-18",
              status: "open",
              seasonYear: SEASON,
              createdByName: "Ada",
              createdAt: "2026-01-18T12:00:00.000Z",
              startCount: 2,
              stopCount: 1,
              continueCount: 1,
              actionOpenCount: 1,
            },
          ],
        };
      }
      if (sql.includes("FROM retro_items li")) {
        return {
          rows: [
            {
              id: "i1",
              sessionId: "s1",
              sessionTitle: "Week 3 retro",
              kind: "start",
              content: "Start doing standups",
              authorName: "Ada",
              createdAt: "2026-01-18T12:00:00.000Z",
              voteCount: 3,
            },
          ],
        };
      }
      if (sql.includes("FROM season_report_entries")) return { rows: [{ count: "0" }] };
      if (sql.includes("FROM knowledge_pages")) return { rows: [] };
      if (sql.includes("FROM retro_items")) {
        return {
          rows: [
            {
              id: "i1",
              sessionId: "s1",
              kind: "start",
              content: "Start doing standups",
              authorName: "Ada",
              createdAt: "2026-01-18T12:00:00.000Z",
              voteCount: 3,
              votedByMe: true,
            },
            {
              id: "i2",
              sessionId: "s1",
              kind: "stop",
              content: "Stop skipping CAD review",
              authorName: "Grace",
              createdAt: "2026-01-18T13:00:00.000Z",
              voteCount: 1,
              votedByMe: false,
            },
          ],
        };
      }
      if (sql.includes("FROM retro_action_items") && sql.includes("LEFT JOIN users cu")) {
        return {
          rows: [
            {
              id: "a1",
              sessionId: "s1",
              title: "Fix intake belt slip",
              owner: "Grace",
              status: "open",
              dueOn: "2026-01-25",
              createdByName: "Ada",
              createdAt: "2026-01-18T12:00:00.000Z",
            },
          ],
        };
      }
      if (sql.includes("FROM retro_postmortems")) return { rows: [] };
      return { rows: [] };
    });

    const view = await computeRetroView(client, { userId: USER, requestedOrg: ORG, seasonYear: SEASON });

    expect(view.status).toBe("live");
    if (view.status !== "live") throw new Error("expected live view");
    expect(view.sessions).toHaveLength(1);
    expect(view.activeSession?.id).toBe("s1");
    expect(view.itemsByKind.start).toHaveLength(1);
    expect(view.itemsByKind.stop).toHaveLength(1);
    expect(view.itemsByKind.continue).toHaveLength(0);
    expect(view.itemsByKind.start[0]?.votedByMe).toBe(true);
    expect(view.actionItems).toHaveLength(1);
    expect(view.actionItems[0]?.owner).toBe("Grace");
    expect(view.learnedItems).toHaveLength(1);
    expect(view.learnedItems[0]?.content).toBe("Start doing standups");
    expect(view.handoff.seasonReportCount).toBe(0);
    expect(view.handoff.playbookPageId).toBeNull();
    expect(view.postmortems).toHaveLength(0);
  });
});

describe("generatePostmortem", () => {
  it("compiles a grounded narrative from counted decisions/risks/incidents/FMEA rows and meters it", async () => {
    const inserts: { sql: string; params: unknown[] }[] = [];
    const client = makeClient((sql, params) => {
      if (sql.includes("FROM decision_records")) {
        return { rows: [{ status: "accepted", count: "3" }, { status: "rejected", count: "1" }] };
      }
      if (sql.includes("FROM risk_register")) {
        return { rows: [{ status: "open", count: "2" }, { status: "closed", count: "1" }] };
      }
      if (sql.includes("FROM incident_reports")) {
        return { rows: [{ severity: "minor", count: "1" }] };
      }
      if (sql.includes("FROM fmea_failures")) {
        return {
          rows: [
            { id: "f1", title: "Intake jam", subsystemName: "intake", rpn: "120", status: "open" },
          ],
        };
      }
      if (sql.includes("FROM retro_action_items")) {
        return { rows: [{ status: "done", count: "2" }, { status: "open", count: "1" }] };
      }
      if (sql.includes("INSERT INTO ai_usage_events")) {
        inserts.push({ sql, params });
        return { rows: [] };
      }
      if (sql.includes("INSERT INTO retro_postmortems")) {
        inserts.push({ sql, params });
        return { rows: [{ id: "p1", createdAt: "2026-02-01T00:00:00.000Z" }] };
      }
      return { rows: [] };
    });

    const postmortem = await generatePostmortem(client, { orgId: ORG, userId: USER, seasonYear: SEASON });

    expect(postmortem.counts.decisionsTotal).toBe(4);
    expect(postmortem.counts.risksOpen).toBe(2);
    expect(postmortem.counts.incidentsTotal).toBe(1);
    expect(postmortem.counts.fmeaFailuresTotal).toBe(1);
    expect(postmortem.counts.retroActionItemsOpen).toBe(1);
    expect(postmortem.narrative).toContain(String(SEASON));
    expect(postmortem.narrative).toContain("Intake jam");

    const usageInsert = inserts.find((entry) => entry.sql.includes("INSERT INTO ai_usage_events"));
    expect(usageInsert).toBeDefined();
    const postmortemInsert = inserts.find((entry) => entry.sql.includes("INSERT INTO retro_postmortems"));
    expect(postmortemInsert).toBeDefined();
  });
});
