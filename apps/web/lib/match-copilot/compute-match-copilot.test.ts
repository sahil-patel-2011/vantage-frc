import type { PoolClient } from "@neondatabase/serverless";
import { describe, expect, it, vi } from "vitest";
import { computeMatchCopilotView } from "./compute-match-copilot";
import { expectPlainCopy } from "../ui/copy-assertions";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "11111111-1111-4111-8111-111111111111";

/** Returns queued rows in call order — mirrors the sequential/Promise.all query
 * order inside computeMatchCopilotView's buildContext(). */
function queueClient(responses: Array<{ rows: unknown[] }>): PoolClient {
  let index = 0;
  return {
    query: vi.fn().mockImplementation(async () => {
      const response = responses[index] ?? { rows: [] };
      index += 1;
      return response;
    }),
  } as unknown as PoolClient;
}

describe("computeMatchCopilotView", () => {
  it("returns setup_required when the caller has no org membership", async () => {
    const client = queueClient([{ rows: [] }]);
    const view = await computeMatchCopilotView(client, { userId: USER, requestedOrg: null });
    expect(view.status).toBe("setup_required");
    if (view.status === "setup_required") {
      expect(view.orgId).toBeNull();
      expect(view.steps.length).toBeGreaterThan(0);
      expect(view.steps[0]?.href).toBe("/workspace");
      expect(view.steps.some((s) => s.href.includes("/competition?tab=strategy"))).toBe(true);
      expect(view.steps.every((s) => !s.href.toLowerCase().includes("demo"))).toBe(true);
      view.steps.forEach((s) => expectPlainCopy(s.detail));
    }
  });

  it("returns setup_required when no active event is set", async () => {
    const client = queueClient([
      { rows: [{ orgId: ORG, teamNumber: 118 }] }, // resolveOrg
      { rows: [{ eventKey: null, eventName: null, seasonYear: null }] }, // resolveActiveEvent
    ]);
    const view = await computeMatchCopilotView(client, { userId: USER, requestedOrg: ORG });
    expect(view.status).toBe("setup_required");
    if (view.status === "setup_required") {
      expect(view.orgId).toBe(ORG);
      expect(view.steps[0]?.href).toBe(`/competition?tab=command&orgId=${ORG}`);
      expect(view.steps.some((s) => s.href.includes("/competition?tab=strategy"))).toBe(true);
      expect(view.steps.every((s) => !s.href.toLowerCase().includes("demo"))).toBe(true);
    }
  });

  it("fuses opponent EPA, strategy plan, open FMEA risk, and battery health into a live brief", async () => {
    const client = queueClient([
      { rows: [{ orgId: ORG, teamNumber: 118 }] }, // resolveOrg
      { rows: [{ eventKey: "2026test", eventName: "Test Regional", seasonYear: 2026 }] }, // resolveActiveEvent
      {
        rows: [
          {
            matchKey: "2026test_qm1",
            compLevel: "qm",
            matchNumber: 1,
            scheduledTime: "2026-03-01T12:00:00Z",
            redAlliance: { teamKeys: ["frc118", "frc254"] },
            blueAlliance: { teamKeys: ["frc1678", "frc33", "frc971"] },
          },
        ],
      }, // resolveNextMatch
      {
        rows: [
          { teamKey: "frc118", epaTotal: 30, epaAuto: 8, epaTeleop: 18, epaEndgame: 4, rank: 5 },
          { teamKey: "frc1678", epaTotal: 55, epaAuto: 15, epaTeleop: 30, epaEndgame: 10, rank: 1 },
        ],
      }, // loadTeams: metrics
      {
        rows: [
          { teamKey: "frc118", teamNumber: 118, nickname: "Robonauts" },
          { teamKey: "frc1678", teamNumber: 1678, nickname: "Citrus Circuits" },
        ],
      }, // loadTeams: teams_ref
      {
        rows: [
          {
            plan: {
              playbook: { name: "Cycle high, avoid 1678 auto lane" },
              matchup: ["Watch 1678 autonomous — highest auto EPA on the field."],
            },
          },
        ],
      }, // loadStrategyPlan
      {
        rows: [
          {
            id: "risk-1",
            subsystemName: "Drivetrain",
            title: "Wheel wear on left front",
            occurrence: 6,
            severity: 7,
            detection: 4,
            status: "open",
          },
        ],
      }, // loadOpenRisks
      {
        rows: [
          { id: "batt-1", label: "Pack A", status: "active", restingVoltage: 12.1, resistanceMilliohms: 28 },
        ],
      }, // loadBatteryFleet
      { rows: [] }, // loadLatestBrief (nothing persisted yet)
    ]);

    const view = await computeMatchCopilotView(client, { userId: USER, requestedOrg: ORG });
    expect(view.status).toBe("live");
    if (view.status !== "live") return;

    expect(view.matchKey).toBe("2026test_qm1");
    expect(view.alliance).toBe("red");
    expect(view.opponents.map((o) => o.teamKey)).toEqual(["frc1678", "frc33", "frc971"]);
    expect(view.allies.map((o) => o.teamKey)).toEqual(["frc254"]);
    expect(view.hasStrategyPlan).toBe(true);
    expect(view.openRisks[0]?.rpn).toBe(6 * 7 * 4);
    expect(view.batteryFleet[0]?.flag).not.toBe("healthy");
    expect(view.generatedBy).toBe("local");
    expect(view.callouts.length).toBeGreaterThan(0);
    expect(view.callouts.length).toBeLessThanOrEqual(3);
    expect(view.callouts.some((c) => c.category === "opponent")).toBe(true);
    expect(view.callouts.some((c) => c.category === "risk")).toBe(true);
  });
});
