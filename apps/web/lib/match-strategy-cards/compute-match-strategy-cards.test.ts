import type { PoolClient } from "@neondatabase/serverless";
import { describe, expect, it, vi } from "vitest";
import { AUTO_COORDINATION_CUE, AUTO_FLEXIBILITY_CUE, DEPLOY_SAFETY_CUE, autoCoordinationCue, autoFlexibilityCue, deploySafetyCue, dutyPlanFromTemplate, matchLabel, teamNumbersFromAllianceJson } from ".";
import { computeMatchStrategyCardsView } from "./compute-match-strategy-cards";

const USER = "11111111-1111-4111-8111-111111111111";
const ORG = "22222222-2222-4222-8222-222222222222";

function mockClient(handler: (sql: string, params: unknown[]) => { rows: unknown[]; rowCount: number }): PoolClient {
  return {
    query: vi.fn((sql: string, params: unknown[] = []) => Promise.resolve(handler(sql, params))),
  } as unknown as PoolClient;
}

describe("match-strategy-cards pure helpers", () => {
  it("extracts sorted team numbers from a matches_ref alliance jsonb blob", () => {
    expect(teamNumbersFromAllianceJson({ team_keys: ["frc254", "frc118", "frc1114"] })).toEqual([118, 254, 1114]);
    expect(teamNumbersFromAllianceJson(null)).toEqual([]);
    expect(teamNumbersFromAllianceJson({})).toEqual([]);
  });

  it("labels qualification vs playoff matches", () => {
    expect(matchLabel({ compLevel: "qm", matchNumber: 12, setNumber: 1 })).toBe("Qualification 12");
    expect(matchLabel({ compLevel: "sf", matchNumber: 2, setNumber: 1 })).toBe("Semifinal 1-2");
  });

  it("fills AllianceOps-style safe/balanced/aggressive duty roles from the real alliance roster", () => {
    const safe = dutyPlanFromTemplate({
      stance: "safe",
      ownTeamNumber: 254,
      partnerNumbers: [118, 1114],
    });
    expect(safe.roleAssignments).toEqual([
      { role: "Primary scorer", assignee: "254" },
      { role: "Feed / cover", assignee: "118" },
      { role: "Defense", assignee: "1114" },
    ]);
    expect(safe.gamePlan).toMatch(/Protect ranking points/);
    const aggressive = dutyPlanFromTemplate({
      stance: "aggressive",
      ownTeamNumber: 254,
      partnerNumbers: [118],
    });
    expect(aggressive.roleAssignments[2]?.assignee).toBe("Partner B");
  });

  it("cues auto coordination only when TBA partners exist and Auto assignment is blank", () => {
    expect(
      autoCoordinationCue({ partnerNumbers: [], autoAssignment: null }),
    ).toBeNull();
    expect(
      autoCoordinationCue({ partnerNumbers: [118, 1114], autoAssignment: "3-piece left" }),
    ).toBeNull();
    expect(
      autoCoordinationCue({ partnerNumbers: [118, 1114], autoAssignment: "  " }),
    ).toBe(AUTO_COORDINATION_CUE);
  });

  it("cues a backup auto only when partners exist and Auto has no flex language", () => {
    expect(autoFlexibilityCue({ partnerNumbers: [118], autoAssignment: null })).toBeNull();
    expect(autoFlexibilityCue({ partnerNumbers: [118], autoAssignment: "3-piece left with backup center" })).toBeNull();
    expect(autoFlexibilityCue({ partnerNumbers: [118], autoAssignment: "3-piece left" })).toBe(AUTO_FLEXIBILITY_CUE);
  });

  it("cues deploy safety from written hood/hopper notes only", () => {
    expect(deploySafetyCue({ gamePlan: null, driverNotes: null })).toBeNull();
    expect(deploySafetyCue({ gamePlan: "Deploy hood, stow for trench", driverNotes: "" })).toBeNull();
    expect(deploySafetyCue({ gamePlan: "Keep hood deployed", driverNotes: "" })).toBe(DEPLOY_SAFETY_CUE);
  });
});

describe("computeMatchStrategyCardsView", () => {
  it("returns setup_required when the user has no org membership", async () => {
    const client = mockClient(() => ({ rows: [], rowCount: 0 }));
    const view = await computeMatchStrategyCardsView(client, { userId: USER, requestedOrg: null });
    expect(view.status).toBe("setup_required");
    if (view.status === "setup_required") {
      expect(view.orgId).toBeNull();
      expect(view.steps.length).toBeGreaterThan(0);
    }
  });

  it("returns setup_required when the org has no active event/team", async () => {
    const client = mockClient((sql) => {
      if (sql.includes("FROM memberships")) {
        return { rows: [{ orgId: ORG, teamNumber: null, eventKey: null, eventName: null }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });
    const view = await computeMatchStrategyCardsView(client, { userId: USER, requestedOrg: ORG });
    expect(view.status).toBe("setup_required");
  });

  it("returns setup_required when the schedule has not synced any matches for the team", async () => {
    const client = mockClient((sql) => {
      if (sql.includes("FROM memberships")) {
        return { rows: [{ orgId: ORG, teamNumber: 254, eventKey: "2026casj", eventName: "Champs" }], rowCount: 1 };
      }
      if (sql.includes("FROM matches_ref")) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 0 };
    });
    const view = await computeMatchStrategyCardsView(client, { userId: USER, requestedOrg: ORG });
    expect(view.status).toBe("setup_required");
  });

  it("returns a live view merging synced matches with any saved strategy card content", async () => {
    const client = mockClient((sql) => {
      if (sql.includes("FROM memberships")) {
        return { rows: [{ orgId: ORG, teamNumber: 254, eventKey: "2026casj", eventName: "Champs" }], rowCount: 1 };
      }
      if (sql.includes("FROM matches_ref")) {
        return {
          rows: [
            {
              matchKey: "2026casj_qm12",
              compLevel: "qm",
              matchNumber: 12,
              setNumber: 1,
              eventKey: "2026casj",
              scheduledAt: "2026-03-14T18:00:00.000Z",
              redAlliance: { team_keys: ["frc254", "frc118", "frc1114"] },
              blueAlliance: { team_keys: ["frc971", "frc2056", "frc33"] },
            },
          ],
          rowCount: 1,
        };
      }
      if (sql.includes("FROM match_strategy_cards")) {
        return {
          rows: [
            {
              matchKey: "2026casj_qm12",
              gamePlan: "Play defense on frc971 early",
              autoAssignment: "3-piece auto",
              defenseFocus: "frc971",
              keyThreats: "frc971 fast cycles",
              driverNotes: "Watch for penalties",
              roleAssignments: [{ role: "Driver", assignee: "Alex" }],
              updatedAt: "2026-03-10T00:00:00.000Z",
            },
          ],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    });

    const view = await computeMatchStrategyCardsView(client, { userId: USER, requestedOrg: ORG });
    expect(view.status).toBe("live");
    if (view.status === "live") {
      expect(view.teamNumber).toBe(254);
      expect(view.cards).toHaveLength(1);
      const card = view.cards[0];
      expect(card.ownAllianceColor).toBe("red");
      expect(card.alliances.find((a) => a.color === "red")?.teamNumbers).toEqual([118, 254, 1114]);
      expect(card.hasCard).toBe(true);
      expect(card.gamePlan).toBe("Play defense on frc971 early");
      expect(card.roleAssignments).toEqual([{ role: "Driver", assignee: "Alex" }]);
    }
  });
});
