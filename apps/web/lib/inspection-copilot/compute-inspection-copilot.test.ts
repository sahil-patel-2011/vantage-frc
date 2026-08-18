import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "@neondatabase/serverless";
import { computeInspectionCopilotView, logCheck } from "./compute-inspection-copilot";
import { predictInspectionFailures, stale120PerimeterCue, stale16ExtensionCue, staleBumperThicknessCue, staleBumperZoneCue, STALE_120_PERIMETER_CUE, STALE_16_EXTENSION_CUE, STALE_BUMPER_ZONE_CUE, STALE_BUMPER_THICKNESS_CUE } from ".";

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
        binderRecorded: false,
        bomPrinted: false,
        inspectionChecklistPrinted: false,
        studentCaptainPresent: false,
        radioEventRecorded: false,
        radioOnMainPd: false,
        rioOnMainPd10A: false,
        radioProgrammedForEvent: false,
        radioWeidmullerQc: false,
        sparkMaxEventRecorded: false,
        sparkMaxUsbAvoided: false,
        reliabilityEventRecorded: false,
        strainReliefOk: false,
        dynamicCableClear: false,
        esdIntakeBonded: false,
        esdShielded: false,
        canivorePdhBackup: false,
        batteryLeadsTorqued: false,
        mainBreakerCovered: false,
        rioUsbCameraClear: false,
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
      radioWeidmullerQc: false,
      sparkMaxEventRecorded: false,
      sparkMaxUsbAvoided: false,
      reliabilityEventRecorded: false,
      strainReliefOk: false,
      dynamicCableClear: false,
      esdIntakeBonded: false,
      esdShielded: false,
      canivorePdhBackup: false,
      batteryLeadsTorqued: false,
      mainBreakerCovered: false,
      rioUsbCameraClear: false,
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
    radioWeidmullerQc: false,
    sparkMaxEventRecorded: false,
    sparkMaxUsbAvoided: false,
    reliabilityEventRecorded: false,
    strainReliefOk: false,
    dynamicCableClear: false,
    esdIntakeBonded: false,
    esdShielded: false,
    canivorePdhBackup: false,
    batteryLeadsTorqued: false,
    mainBreakerCovered: false,
    rioUsbCameraClear: false,
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
    expect(prediction.flags.some((flag) => flag.type === "radio_weidmuller_strands")).toBe(false);
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
        radioWeidmullerQc: true,
      },
    });
    expect(prediction.flags.some((flag) => flag.type === "radio_not_on_main_pd")).toBe(true);
    expect(prediction.flags.some((flag) => flag.type === "radio_weidmuller_strands")).toBe(false);
    expect(prediction.flags.find((flag) => flag.type === "radio_not_on_main_pd")?.message.toLowerCase()).not.toContain(
      "demo",
    );
  });

  it("flags un-QC'd VH-109 Weidmuller leads once radio wiring is logged", () => {
    const prediction = predictInspectionFailures({
      ...limits,
      wiringPower: {
        ...wiring,
        radioEventRecorded: true,
        radioOnMainPd: true,
        rioOnMainPd10A: true,
        radioProgrammedForEvent: true,
        radioWeidmullerQc: false,
      },
    });
    expect(prediction.flags.some((flag) => flag.type === "radio_weidmuller_strands")).toBe(true);
    expect(JSON.stringify(prediction.flags).toLowerCase()).not.toContain("demo");
  });
});

describe("predictInspectionFailures Spark MAX USB", () => {
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
    radioWeidmullerQc: false,
    sparkMaxEventRecorded: false,
    sparkMaxUsbAvoided: false,
    reliabilityEventRecorded: false,
    strainReliefOk: false,
    dynamicCableClear: false,
    esdIntakeBonded: false,
    esdShielded: false,
    canivorePdhBackup: false,
    batteryLeadsTorqued: false,
    mainBreakerCovered: false,
    rioUsbCameraClear: false,
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

  it("does not invent a Spark MAX USB fail when the team has not logged it", () => {
    const prediction = predictInspectionFailures({ ...limits, wiringPower: wiring });
    expect(prediction.flags.some((flag) => flag.type === "spark_max_usb_risk")).toBe(false);
  });

  it("flags USB-C on a suspect Spark MAX once the team records that check", () => {
    const prediction = predictInspectionFailures({
      ...limits,
      wiringPower: { ...wiring, sparkMaxEventRecorded: true, sparkMaxUsbAvoided: false },
    });
    expect(prediction.flags.some((flag) => flag.type === "spark_max_usb_risk")).toBe(true);
    expect(prediction.flags.find((flag) => flag.type === "spark_max_usb_risk")?.message.toLowerCase()).toMatch(/motherboard|usb/);
    expect(prediction.flags.find((flag) => flag.type === "spark_max_usb_risk")?.message.toLowerCase()).not.toContain("demo");
  });
});

describe("predictInspectionFailures 2026 pit reliability", () => {
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
    radioWeidmullerQc: false,
    sparkMaxEventRecorded: false,
    sparkMaxUsbAvoided: false,
    reliabilityEventRecorded: false,
    strainReliefOk: false,
    dynamicCableClear: false,
    esdIntakeBonded: false,
    esdShielded: false,
    canivorePdhBackup: false,
    batteryLeadsTorqued: false,
    mainBreakerCovered: false,
    rioUsbCameraClear: false,
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

  it("does not invent strain-relief or ESD fails until the team logs the walk", () => {
    const prediction = predictInspectionFailures({ ...limits, wiringPower: wiring });
    expect(prediction.flags.some((flag) => flag.type === "strain_relief_missing")).toBe(false);
    expect(prediction.flags.some((flag) => flag.type === "esd_intake_unbonded")).toBe(false);
    expect(prediction.flags.some((flag) => flag.type === "rio_usb_camera_canivore")).toBe(false);
  });

  it("flags logged reliability gaps without DEMO wording", () => {
    const prediction = predictInspectionFailures({
      ...limits,
      wiringPower: { ...wiring, reliabilityEventRecorded: true },
    });
    expect(prediction.flags.map((flag) => flag.type)).toEqual(
      expect.arrayContaining([
        "strain_relief_missing",
        "dynamic_cable_pinch",
        "esd_intake_unbonded",
        "esd_unshielded",
        "canivore_no_pdh_backup",
        "battery_leads_loose",
        "main_breaker_exposed",
        "rio_usb_camera_canivore",
      ]),
    );
    expect(JSON.stringify(prediction.flags).toLowerCase()).not.toContain("demo");
    expect(JSON.stringify(prediction.flags).toLowerCase()).not.toContain("cheesycare");
  });
});

describe("predictInspectionFailures bumper construction", () => {
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
    radioWeidmullerQc: false,
    sparkMaxEventRecorded: false,
    sparkMaxUsbAvoided: false,
    reliabilityEventRecorded: false,
    strainReliefOk: false,
    dynamicCableClear: false,
    esdIntakeBonded: false,
    esdShielded: false,
    canivorePdhBackup: false,
    batteryLeadsTorqued: false,
    mainBreakerCovered: false,
    rioUsbCameraClear: false,
  };
  const frameBumper = {
    perimeterLimitIn: 120,
    measuredPerimeterIn: 110,
    bumperMinHeightIn: 2.5,
    bumperMaxHeightIn: 7.5,
    measuredBumperMinHeightIn: 3,
    measuredBumperMaxHeightIn: 6,
    bumperMinThicknessIn: 1,
    measuredBumperThicknessIn: 1.5,
  };
  const weightBudget = { limitLbs: 125, items: [{ name: "Chassis", weightLbs: 80 }] };

  it("does not invent hollow foam or reversible bumpers until construction is logged", () => {
    const prediction = predictInspectionFailures({ weightBudget, frameBumper, wiringPower: wiring });
    expect(prediction.flags.some((flag) => flag.type === "bumper_hollow_foam")).toBe(false);
    expect(prediction.flags.some((flag) => flag.type === "bumper_reversible")).toBe(false);
  });

  it("flags logged hollow foam and reversible sets without DEMO wording", () => {
    const prediction = predictInspectionFailures({
      weightBudget,
      frameBumper: { ...frameBumper, bumperEventRecorded: true },
      wiringPower: wiring,
    });
    expect(prediction.flags.map((flag) => flag.type)).toEqual(
      expect.arrayContaining(["bumper_hollow_foam", "bumper_reversible"]),
    );
    expect(JSON.stringify(prediction.flags).toLowerCase()).not.toContain("demo");
  });
});

describe("predictInspectionFailures pneumatics", () => {
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
    radioWeidmullerQc: false,
    sparkMaxEventRecorded: false,
    sparkMaxUsbAvoided: false,
    reliabilityEventRecorded: false,
    strainReliefOk: false,
    dynamicCableClear: false,
    esdIntakeBonded: false,
    esdShielded: false,
    canivorePdhBackup: false,
    batteryLeadsTorqued: false,
    mainBreakerCovered: false,
    rioUsbCameraClear: false,
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

  it("does not invent a vent-plug fail when the robot has no pneumatics walk", () => {
    const prediction = predictInspectionFailures({ ...limits, wiringPower: wiring });
    expect(prediction.flags.some((flag) => flag.type === "pneumatics_vent_plug")).toBe(false);
    expect(prediction.flags.some((flag) => flag.type === "pneumatics_multi_compressor")).toBe(false);
    expect(prediction.flags.some((flag) => flag.type === "pneumatics_relief_valve")).toBe(false);
    expect(prediction.flags.some((flag) => flag.type === "pneumatics_working_pressure")).toBe(false);
    expect(prediction.flags.some((flag) => flag.type === "pneumatics_pressure_switch")).toBe(false);
  });

  it("flags a hidden vent plug once pneumatics are logged", () => {
    const prediction = predictInspectionFailures({
      ...limits,
      wiringPower: { ...wiring, pneumaticsEventRecorded: true, singleOnboardCompressor: true },
    });
    expect(prediction.flags.some((flag) => flag.type === "pneumatics_vent_plug")).toBe(true);
    expect(prediction.flags.some((flag) => flag.type === "pneumatics_multi_compressor")).toBe(false);
    expect(prediction.flags.some((flag) => flag.type === "pneumatics_relief_valve")).toBe(true);
    expect(prediction.flags.some((flag) => flag.type === "pneumatics_working_pressure")).toBe(true);
    expect(prediction.flags.some((flag) => flag.type === "pneumatics_pressure_switch")).toBe(true);
    expect(JSON.stringify(prediction.flags).toLowerCase()).not.toContain("demo");
  });

  it("does not flag working pressure or the pressure switch once they are logged", () => {
    const prediction = predictInspectionFailures({
      ...limits,
      wiringPower: {
        ...wiring,
        pneumaticsEventRecorded: true,
        ventPlugAccessible: true,
        singleOnboardCompressor: true,
        reliefValveOnCompressor: true,
        workingPressure60Psi: true,
        pressureSwitchOnPcmPh: true,
      },
    });
    expect(prediction.flags.some((flag) => flag.type === "pneumatics_working_pressure")).toBe(false);
    expect(prediction.flags.some((flag) => flag.type === "pneumatics_pressure_switch")).toBe(false);
    expect(JSON.stringify(prediction.flags).toLowerCase()).not.toContain("demo");
  });
});

describe("predictInspectionFailures R611 isolation", () => {
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
    radioWeidmullerQc: false,
    sparkMaxEventRecorded: false,
    sparkMaxUsbAvoided: false,
    reliabilityEventRecorded: false,
    strainReliefOk: false,
    dynamicCableClear: false,
    esdIntakeBonded: false,
    esdShielded: false,
    canivorePdhBackup: false,
    batteryLeadsTorqued: false,
    mainBreakerCovered: false,
    rioUsbCameraClear: false,
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

  it("does not invent a chassis short until isolation is logged", () => {
    const prediction = predictInspectionFailures({ ...limits, wiringPower: wiring });
    expect(prediction.flags.some((flag) => flag.type === "frame_not_isolated")).toBe(false);
    expect(prediction.flags.some((flag) => flag.type === "pdh_ports_untaped")).toBe(false);
  });

  it("flags a logged R611 fail and untaped PDH ports without DEMO wording", () => {
    const prediction = predictInspectionFailures({
      ...limits,
      wiringPower: { ...wiring, isolationEventRecorded: true },
    });
    expect(prediction.flags.map((flag) => flag.type)).toEqual(
      expect.arrayContaining(["frame_not_isolated", "pdh_ports_untaped"]),
    );
    expect(JSON.stringify(prediction.flags).toLowerCase()).not.toContain("demo");
  });
});

describe("2026 starting-config size", () => {
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
    radioWeidmullerQc: false,
    sparkMaxEventRecorded: false,
    sparkMaxUsbAvoided: false,
    reliabilityEventRecorded: false,
    strainReliefOk: false,
    dynamicCableClear: false,
    esdIntakeBonded: false,
    esdShielded: false,
    canivorePdhBackup: false,
    batteryLeadsTorqued: false,
    mainBreakerCovered: false,
    rioUsbCameraClear: false,
  };

  it("does not invent a bumper-zone fail when height was not measured", () => {
    const prediction = predictInspectionFailures({
      weightBudget: { limitLbs: 115, items: [{ name: "Chassis", weightLbs: 80 }] },
      frameBumper: {
        perimeterLimitIn: 110,
        measuredPerimeterIn: 0,
        bumperMinHeightIn: 2.75,
        bumperMaxHeightIn: 5.5,
        measuredBumperMinHeightIn: 0,
        measuredBumperMaxHeightIn: 0,
        bumperMinThicknessIn: 2,
        measuredBumperThicknessIn: 0,
        startingHeightLimitIn: 30,
        measuredStartingHeightIn: 0,
      },
      wiringPower: wiring,
    });
    expect(prediction.flags.some((flag) => flag.type === "bumper_height_out_of_range")).toBe(false);
    expect(prediction.flags.some((flag) => flag.type === "bumper_undersized_thickness")).toBe(false);
    expect(prediction.flags.some((flag) => flag.type === "starting_height_exceeded")).toBe(false);
    expect(prediction.flags.some((flag) => flag.type === "extension_exceeded")).toBe(false);
  });

  it("flags a logged starting height over 30 in without DEMO wording", () => {
    const prediction = predictInspectionFailures({
      weightBudget: { limitLbs: 115, items: [{ name: "Chassis", weightLbs: 80 }] },
      frameBumper: {
        perimeterLimitIn: 110,
        measuredPerimeterIn: 108,
        bumperMinHeightIn: 2.75,
        bumperMaxHeightIn: 5.5,
        measuredBumperMinHeightIn: 3,
        measuredBumperMaxHeightIn: 5,
        bumperMinThicknessIn: 2,
        measuredBumperThicknessIn: 2.25,
        startingHeightLimitIn: 30,
        measuredStartingHeightIn: 32,
      },
      wiringPower: wiring,
    });
    expect(prediction.flags.some((flag) => flag.type === "starting_height_exceeded")).toBe(true);
    expect(JSON.stringify(prediction.flags).toLowerCase()).not.toContain("demo");
  });

  it("flags a logged in-match extension over 12 in without DEMO wording", () => {
    const prediction = predictInspectionFailures({
      weightBudget: { limitLbs: 115, items: [{ name: "Chassis", weightLbs: 80 }] },
      frameBumper: {
        perimeterLimitIn: 110,
        measuredPerimeterIn: 108,
        bumperMinHeightIn: 2.75,
        bumperMaxHeightIn: 5.5,
        measuredBumperMinHeightIn: 3,
        measuredBumperMaxHeightIn: 5,
        bumperMinThicknessIn: 2,
        measuredBumperThicknessIn: 2.25,
        startingHeightLimitIn: 30,
        measuredStartingHeightIn: 28,
        extensionLimitIn: 12,
        measuredExtensionIn: 16,
      },
      wiringPower: wiring,
    });
    expect(prediction.flags.some((flag) => flag.type === "extension_exceeded")).toBe(true);
    expect(JSON.stringify(prediction.flags).toLowerCase()).not.toContain("demo");
  });

  it("cues leftover 120 in / 7.5 in / 1 in / 16 in inspection defaults", () => {
    expect(stale120PerimeterCue(110)).toBeNull();
    expect(stale120PerimeterCue(120)).toBe(STALE_120_PERIMETER_CUE);
    expect(staleBumperZoneCue(5.5)).toBeNull();
    expect(staleBumperZoneCue(7.5)).toBe(STALE_BUMPER_ZONE_CUE);
    expect(staleBumperThicknessCue(2)).toBeNull();
    expect(staleBumperThicknessCue(1)).toBe(STALE_BUMPER_THICKNESS_CUE);
    expect(stale16ExtensionCue(12)).toBeNull();
    expect(stale16ExtensionCue(16)).toBe(STALE_16_EXTENSION_CUE);
  });
});
