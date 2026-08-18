import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "@neondatabase/serverless";
import { computeInspectionCopilotView, logCheck } from "./compute-inspection-copilot";
import { predictInspectionFailures } from ".";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "11111111-1111-4111-8111-111111111111";

function makeClient(handler: (sql: string, params: unknown[]) => { rows: unknown[]; rowCount?: number }): PoolClient {
  return {
    query: vi.fn(async (sql: string, params: unknown[] = []) => handler(sql, params)),
  } as unknown as PoolClient;
}

describe("computeInspectionCopilotView", () => {
  it("returns setup_required when the user has no org membership", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) return { rows: [] };
      return { rows: [] };
    });

    const view = await computeInspectionCopilotView(client, { userId: USER, requestedOrg: null });

    expect(view.status).toBe("setup_required");
    if (view.status === "setup_required") {
      expect(view.orgId).toBeNull();
      expect(view.steps.length).toBeGreaterThan(0);
    }
  });

  it("returns a live view built from stored inspection checks", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) {
        return { rows: [{ orgId: ORG, teamNumber: 254 }] };
      }
      if (sql.includes("FROM inspection_copilot_checks") && sql.includes("SELECT id")) {
        return {
          rows: [
            {
              id: "check-1",
              seasonYear: 2026,
              robotName: "Vantage Bot",
              weightBudget: { limitLbs: 125, items: [{ name: "Chassis", weightLbs: 130 }] },
              frameBumper: {
                perimeterLimitIn: 120,
                measuredPerimeterIn: 110,
                bumperMinHeightIn: 2.5,
                bumperMaxHeightIn: 7.5,
                measuredBumperMinHeightIn: 2.5,
                measuredBumperMaxHeightIn: 7.5,
                bumperMinThicknessIn: 1,
                measuredBumperThicknessIn: 1,
              },
              wiringPower: {
                mainBreakerMaxAmps: 120,
                installedMainBreakerAmps: 120,
                batterySecured: true,
                wiresLabeled: true,
                radioPowerOk: true,
                bypassSwitchAccessible: true,
              },
              flags: [
                {
                  type: "weight_over_limit",
                  severity: "critical",
                  message: "Itemized weight 130 lbs exceeds the 125 lbs limit",
                },
              ],
              riskScore: "0.111",
              totalWeightLbs: "130.00",
              summary: "1 critical and 0 warning issue(s) predicted — resolve critical items before you travel.",
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

    const view = await computeInspectionCopilotView(client, { userId: USER, requestedOrg: ORG, seasonYear: 2026 });

    expect(view.status).toBe("live");
    if (view.status !== "live") throw new Error("expected live view");
    expect(view.checks).toHaveLength(1);
    expect(view.checks[0]?.flags).toHaveLength(1);
    expect(view.checks[0]?.flags[0]?.type).toBe("weight_over_limit");
    expect(view.checks[0]?.totalWeightLbs).toBeCloseTo(130);
  });
});

describe("logCheck", () => {
  it("computes and persists a deterministic prediction grounded in declared limits vs measurements", async () => {
    const inserted: { sql: string; params: unknown[] }[] = [];
    const client = makeClient((sql, params) => {
      if (sql.includes("INSERT INTO ai_usage_events")) {
        inserted.push({ sql, params });
        return { rows: [] };
      }
      if (sql.includes("INSERT INTO inspection_copilot_checks")) {
        inserted.push({ sql, params });
        return { rows: [] };
      }
      return { rows: [] };
    });

    await logCheck(client, {
      orgId: ORG,
      userId: USER,
      seasonYear: 2026,
      robotName: "Vantage Bot",
      weightBudget: {
        limitLbs: 125,
        items: [
          { name: "Chassis", weightLbs: 90 },
          { name: "Superstructure", weightLbs: 40 },
        ],
      },
      frameBumper: {
        perimeterLimitIn: 120,
        measuredPerimeterIn: 118,
        bumperMinHeightIn: 2.5,
        bumperMaxHeightIn: 7.5,
        measuredBumperMinHeightIn: 3,
        measuredBumperMaxHeightIn: 6,
        bumperMinThicknessIn: 1,
        measuredBumperThicknessIn: 0.75,
      },
      wiringPower: {
        mainBreakerMaxAmps: 120,
        installedMainBreakerAmps: 120,
        batterySecured: false,
        wiresLabeled: true,
        radioPowerOk: true,
        bypassSwitchAccessible: true,
      },
    });

    const checkInsert = inserted.find((entry) => entry.sql.includes("INSERT INTO inspection_copilot_checks"));
    expect(checkInsert).toBeDefined();
    const flagsJson = String(checkInsert?.params[6]);
    expect(flagsJson).toContain("weight_over_limit");
    expect(flagsJson).toContain("bumper_undersized_thickness");
    expect(flagsJson).toContain("battery_not_secured");

    const usageInsert = inserted.find((entry) => entry.sql.includes("INSERT INTO ai_usage_events"));
    expect(usageInsert).toBeDefined();
  });
});

describe("predictInspectionFailures binder", () => {
  const base = {
    weightBudget: { limitLbs: 125, items: [{ name: "Chassis", weightLbs: 80 }] },
    frameBumper: {
      perimeterLimitIn: 120,
      measuredPerimeterIn: 110,
      bumperMinHeightIn: 2.5,
      bumperMaxHeightIn: 7.5,
      measuredBumperMinHeightIn: 3,
      measuredBumperMaxHeightIn: 6,
      bumperMinThicknessIn: 1,
      measuredBumperThicknessIn: 1.5,
    },
    wiringPower: {
      mainBreakerMaxAmps: 120,
      installedMainBreakerAmps: 120,
      batterySecured: true,
      wiresLabeled: true,
      radioPowerOk: true,
      bypassSwitchAccessible: true,
      binderRecorded: false,
      bomPrinted: false,
      inspectionChecklistPrinted: false,
      studentCaptainPresent: false,
      radioEventRecorded: false,
      radioOnMainPd: false,
      rioOnMainPd10A: false,
      radioProgrammedForEvent: false,
    },
  };

  it("does not invent a missing BOM when binder status was not logged", () => {
    const prediction = predictInspectionFailures(base);
    expect(prediction.flags.some((flag) => flag.type === "bom_not_printed")).toBe(false);
  });

  it("flags a missing printed BOM once the team records binder status", () => {
    const prediction = predictInspectionFailures({
      ...base,
      wiringPower: { ...base.wiringPower, binderRecorded: true, bomPrinted: false, inspectionChecklistPrinted: true, studentCaptainPresent: true },
    });
    expect(prediction.flags.some((flag) => flag.type === "bom_not_printed")).toBe(true);
  });
});

describe("predictInspectionFailures 2026 radio/RIO PD", () => {
  const wiring = {
    mainBreakerMaxAmps: 120,
    installedMainBreakerAmps: 120,
    batterySecured: true,
    wiresLabeled: true,
    radioPowerOk: true,
    bypassSwitchAccessible: true,
    binderRecorded: false,
    bomPrinted: false,
    inspectionChecklistPrinted: false,
    studentCaptainPresent: false,
    radioEventRecorded: false,
    radioOnMainPd: false,
    rioOnMainPd10A: false,
    radioProgrammedForEvent: false,
  };
  const limits = {
    weightBudget: { limitLbs: 125, items: [{ name: "Chassis", weightLbs: 80 }] },
    frameBumper: {
      perimeterLimitIn: 120,
      measuredPerimeterIn: 110,
      bumperMinHeightIn: 2.5,
      bumperMaxHeightIn: 7.5,
      measuredBumperMinHeightIn: 3,
      measuredBumperMaxHeightIn: 6,
      bumperMinThicknessIn: 1,
      measuredBumperThicknessIn: 1.5,
    },
  };

  it("does not invent a Mini-PD radio fail when event wiring was not logged", () => {
    const prediction = predictInspectionFailures({ ...limits, wiringPower: wiring });
    expect(prediction.flags.some((flag) => flag.type === "radio_not_on_main_pd")).toBe(false);
    expect(prediction.flags.some((flag) => flag.type === "rio_not_on_main_pd")).toBe(false);
    expect(prediction.flags.some((flag) => flag.type === "radio_not_programmed_for_event")).toBe(false);
  });

  it("flags radio off the main PD once the team records 2026 event wiring", () => {
    const prediction = predictInspectionFailures({
      ...limits,
      wiringPower: {
        ...wiring,
        radioEventRecorded: true,
        radioOnMainPd: false,
        rioOnMainPd10A: true,
        radioProgrammedForEvent: true,
      },
    });
    expect(prediction.flags.some((flag) => flag.type === "radio_not_on_main_pd")).toBe(true);
    expect(prediction.flags.find((flag) => flag.type === "radio_not_on_main_pd")?.message.toLowerCase()).not.toContain(
      "demo",
    );
  });
});
