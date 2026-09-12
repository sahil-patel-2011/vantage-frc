import type { PoolClient } from "@neondatabase/serverless";
import { describe, expect, it, vi } from "vitest";
import { buildEvidenceNote, buildPartnerStrengths, classifyPartnerRole } from ".";
import {
  computeAlliancePartnerBriefView,
  generateAlliancePartnerBrief,
} from "./compute-alliance-partner-brief";
import { expectPlainCopy } from "../ui/copy-assertions";

const USER = "11111111-1111-4111-8111-111111111111";
const ORG = "22222222-2222-4222-8222-222222222222";
const BOARD = "33333333-3333-4333-8333-333333333333";

function mockClient(handler: (sql: string, params: unknown[]) => { rows: unknown[]; rowCount: number }): PoolClient {
  return {
    query: vi.fn((sql: string, params: unknown[] = []) => Promise.resolve(handler(sql, params))),
  } as unknown as PoolClient;
}

const BOARD_STATE = {
  alliances: [
    { seed: 1, captainTeamKey: "frc254", firstPickTeamKey: "frc118", secondPickTeamKey: "frc1114" },
    { seed: 2, captainTeamKey: "frc971", firstPickTeamKey: "frc2056", secondPickTeamKey: null },
  ],
};

describe("alliance-partner-brief pure helpers", () => {
  it("classifies role from EPA breakdown, and unproven when there is no metrics source", () => {
    expect(classifyPartnerRole(null)).toBe("unproven");
    expect(
      classifyPartnerRole({
        epaTotal: 40,
        epaAuto: 20,
        epaTeleop: 15,
        epaEndgame: 5,
        rank: 3,
        wins: 5,
        losses: 1,
        ties: 0,
        source: "tba",
      }),
    ).toBe("auto_specialist");
    expect(
      classifyPartnerRole({
        epaTotal: 30,
        epaAuto: 2,
        epaTeleop: 25,
        epaEndgame: 3,
        rank: 5,
        wins: 4,
        losses: 2,
        ties: 0,
        source: "tba",
      }),
    ).toBe("teleop_scorer");
  });

  it("builds strengths only from real numbers, never inventing claims", () => {
    expect(buildPartnerStrengths(null, 0, 0)).toEqual([]);
    const strengths = buildPartnerStrengths(
      { epaTotal: 40.5, epaAuto: 10, epaTeleop: 25, epaEndgame: 5.5, rank: 2, wins: 6, losses: 1, ties: 0, source: "tba" },
      3,
      1,
    );
    expect(strengths).toContain("Season rating 40.5");
    expect(strengths).toContain("Event rank #2");
    expect(strengths.some((s) => s.includes("match-scout"))).toBe(true);
  });

  it("describes evidence coverage without fabricating data", () => {
    expect(buildEvidenceNote(null, 0, 0)).toMatch(/No event metrics or scouting/);
    expect(buildEvidenceNote({ epaTotal: 10, epaAuto: null, epaTeleop: null, epaEndgame: null, rank: null, wins: 0, losses: 0, ties: 0, source: "tba" }, 0, 0)).toMatch(/Event metrics only/);
  });
});

describe("computeAlliancePartnerBriefView", () => {
  it("returns setup_required when the user has no org membership", async () => {
    const client = mockClient(() => ({ rows: [], rowCount: 0 }));
    const view = await computeAlliancePartnerBriefView(client, { userId: USER, requestedOrg: null });
    expect(view.status).toBe("setup_required");
    if (view.status === "setup_required") {
      expect(view.orgId).toBeNull();
      expect(view.steps.map((s) => s.id)).toEqual(
        expect.arrayContaining(["workspace", "alliance-board", "strategy", "scouting"]),
      );
      expect(view.steps.find((s) => s.id === "workspace")?.href).toBe("/workspace");
      expect(view.steps.find((s) => s.id === "alliance-board")?.href).toBe("/strategy/draft");
      expect(view.steps.find((s) => s.id === "strategy")?.href).toBe("/competition?tab=strategy");
      expect(view.steps.find((s) => s.id === "scouting")?.href).toBe("/competition?tab=scouting");
      expect(view.steps.every((s) => !s.href.toLowerCase().includes("demo"))).toBe(true);
      view.steps.forEach((s) => expectPlainCopy(s.detail));
    }
  });

  it("returns setup_required when the org has no alliance board yet", async () => {
    const client = mockClient((sql) => {
      if (sql.includes("FROM memberships")) return { rows: [{ orgId: ORG, teamNumber: 5817 }], rowCount: 1 };
      if (sql.includes("FROM alliance_boards")) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 0 };
    });
    const view = await computeAlliancePartnerBriefView(client, { userId: USER, requestedOrg: ORG });
    expect(view.status).toBe("setup_required");
    if (view.status === "setup_required") {
      expect(view.orgId).toBe(ORG);
      expect(view.steps.find((s) => s.id === "alliance-board")?.href).toBe(
        `/strategy/draft?orgId=${ORG}`,
      );
      expect(view.steps.find((s) => s.id === "strategy")?.href).toBe(
        `/competition?tab=strategy&orgId=${ORG}`,
      );
    }
  });

  it("returns a live view over a finalized board, highlighting our alliance and any saved brief", async () => {
    const client = mockClient((sql) => {
      if (sql.includes("FROM memberships")) return { rows: [{ orgId: ORG, teamNumber: 254 }], rowCount: 1 };
      if (sql.includes("FROM alliance_boards")) {
        return { rows: [{ id: BOARD, name: "Champs Draft", eventKey: "2026casj", state: BOARD_STATE }], rowCount: 1 };
      }
      if (sql.includes("FROM events_ref")) return { rows: [{ name: "Champs" }], rowCount: 1 };
      if (sql.includes("FROM alliance_partner_brief_briefs")) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 0 };
    });

    const view = await computeAlliancePartnerBriefView(client, { userId: USER, requestedOrg: ORG });
    expect(view.status).toBe("live");
    if (view.status === "live") {
      expect(view.eventKey).toBe("2026casj");
      expect(view.selectedSeed).toBe(1);
      expect(view.alliances.find((a) => a.seed === 1)?.isOurAlliance).toBe(true);
      expect(view.brief).toBeNull();
    }
  });
});

describe("generateAlliancePartnerBrief", () => {
  it("generates and persists a partner brief grounded in event metrics + scouting, metering via local_cli", async () => {
    const queries: string[] = [];
    const client = mockClient((sql) => {
      queries.push(sql);
      if (sql.includes("FROM alliance_boards")) {
        return { rows: [{ id: BOARD, name: "Champs Draft", eventKey: "2026casj", state: BOARD_STATE }], rowCount: 1 };
      }
      if (sql.includes("FROM organizations WHERE id")) return { rows: [{ teamNumber: 254 }], rowCount: 1 };
      if (sql.includes("FROM teams_ref")) {
        return {
          rows: [
            { teamKey: "frc118", teamNumber: 118, nickname: "Robonauts" },
            { teamKey: "frc1114", teamNumber: 1114, nickname: "Simbotics" },
          ],
          rowCount: 2,
        };
      }
      if (sql.includes("FROM team_event_metrics")) {
        return {
          rows: [
            { teamKey: "frc118", epaTotal: 38.2, epaAuto: 8, epaTeleop: 25, epaEndgame: 5.2, rank: 4, wins: 6, losses: 2, ties: 0, source: "tba" },
          ],
          rowCount: 1,
        };
      }
      if (sql.includes("FROM match_scout_entries")) {
        return { rows: [{ teamKey: "frc118", count: "3" }], rowCount: 1 };
      }
      if (sql.includes("FROM pit_scout_entries")) {
        return { rows: [{ teamKey: "frc1114", count: "1" }], rowCount: 1 };
      }
      if (sql.includes("INSERT INTO ai_usage_events")) return { rows: [], rowCount: 1 };
      if (sql.includes("INSERT INTO alliance_partner_brief_briefs")) return { rows: [], rowCount: 1 };
      if (sql.includes("FROM memberships")) return { rows: [{ orgId: ORG, teamNumber: 254 }], rowCount: 1 };
      if (sql.includes("FROM events_ref")) return { rows: [{ name: "Champs" }], rowCount: 1 };
      if (sql.includes('"ourTeamKey"')) {
        return {
          rows: [
            {
              id: "brief-1",
              ourTeamKey: "frc254",
              partnerTeamKeys: ["frc118", "frc1114"],
              partners: [
                { teamKey: "frc118", teamNumber: 118, nickname: "Robonauts", slot: "first", role: "teleop_scorer", roleLabel: "Teleop scorer", strengths: ["Season rating 38.2"], epa: null, matchScoutEntryCount: 3, pitScoutEntryCount: 0, evidenceNote: "Event metrics + our own scouting" },
                { teamKey: "frc1114", teamNumber: 1114, nickname: "Simbotics", slot: "second", role: "unproven", roleLabel: "Unproven — no event data yet", strengths: [], epa: null, matchScoutEntryCount: 0, pitScoutEntryCount: 1, evidenceNote: "Our own scouting only — no event metrics synced yet" },
              ],
              updatedAt: new Date().toISOString(),
            },
          ],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    });

    const view = await generateAlliancePartnerBrief(client, { orgId: ORG, userId: USER, allianceSeed: 1 });

    expect(view.status).toBe("live");
    if (view.status === "live") {
      expect(view.brief?.partners).toHaveLength(2);
      expect(view.brief?.partners.find((p) => p.teamKey === "frc118")?.roleLabel).toBe("Teleop scorer");
    }
    expect(queries.some((q) => q.includes("INSERT INTO ai_usage_events"))).toBe(true);
    expect(queries.some((q) => q.includes("INSERT INTO alliance_partner_brief_briefs"))).toBe(true);
  });

  it("throws instead of fabricating a brief when the alliance has no partner teams yet", async () => {
    const client = mockClient((sql) => {
      if (sql.includes("FROM alliance_boards")) {
        return {
          rows: [{ id: BOARD, name: "Champs Draft", eventKey: "2026casj", state: { alliances: [{ seed: 3, captainTeamKey: null, firstPickTeamKey: null, secondPickTeamKey: null }] } }],
          rowCount: 1,
        };
      }
      if (sql.includes("FROM organizations WHERE id")) return { rows: [{ teamNumber: 254 }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
    await expect(
      generateAlliancePartnerBrief(client, { orgId: ORG, userId: USER, allianceSeed: 3 }),
    ).rejects.toThrow(/no partner teams/);
  });
});
