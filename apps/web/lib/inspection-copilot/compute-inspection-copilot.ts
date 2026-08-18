import { randomUUID } from "node:crypto";
import type { PoolClient } from "@neondatabase/serverless";
import { meteredAI } from "@vantage/billing";
import { predictInspectionFailures } from ".";
import type {
  FrameBumperSpec,
  InspectionCopilotCheck,
  InspectionFlag,
  WeightBudgetSpec,
  WeightItem,
  WiringPowerSpec,
} from "./types";

export type InspectionCopilotSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export type InspectionCopilotView =
  | {
      status: "setup_required";
      message: string;
      steps: InspectionCopilotSetupStep[];
      orgId: string | null;
      seasonYear: number;
    }
  | {
      status: "live";
      orgId: string;
      teamNumber: number | null;
      seasonYear: number;
      seasons: number[];
      checks: InspectionCopilotCheck[];
      computedAt: string;
    };

export function currentSeasonYear(now: Date = new Date()): number {
  return now.getUTCFullYear();
}

function nonNegativeNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : 0;
}

/** Parse an untrusted weight-item array from a request body into typed WeightItem rows. */
export function parseWeightItems(value: unknown): WeightItem[] {
  if (!Array.isArray(value)) return [];
  const out: WeightItem[] = [];
  for (const raw of value.slice(0, 64)) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    const name = typeof row.name === "string" ? row.name.trim().slice(0, 120) : "";
    const weightLbs = nonNegativeNumber(row.weightLbs);
    if (!name) continue;
    out.push({ name, weightLbs });
  }
  return out;
}

/** Parse an untrusted weight-budget object from a request body into a typed WeightBudgetSpec. */
export function parseWeightBudget(value: unknown): WeightBudgetSpec {
  const row = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    limitLbs: nonNegativeNumber(row.limitLbs),
    items: parseWeightItems(row.items),
  };
}

/** Parse an untrusted frame/bumper object from a request body into a typed FrameBumperSpec. */
export function parseFrameBumper(value: unknown): FrameBumperSpec {
  const row = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    perimeterLimitIn: nonNegativeNumber(row.perimeterLimitIn),
    measuredPerimeterIn: nonNegativeNumber(row.measuredPerimeterIn),
    bumperMinHeightIn: nonNegativeNumber(row.bumperMinHeightIn),
    bumperMaxHeightIn: nonNegativeNumber(row.bumperMaxHeightIn),
    measuredBumperMinHeightIn: nonNegativeNumber(row.measuredBumperMinHeightIn),
    measuredBumperMaxHeightIn: nonNegativeNumber(row.measuredBumperMaxHeightIn),
    bumperMinThicknessIn: nonNegativeNumber(row.bumperMinThicknessIn),
    measuredBumperThicknessIn: nonNegativeNumber(row.measuredBumperThicknessIn),
    startingHeightLimitIn: nonNegativeNumber(row.startingHeightLimitIn),
    measuredStartingHeightIn: nonNegativeNumber(row.measuredStartingHeightIn),
    extensionLimitIn: nonNegativeNumber(row.extensionLimitIn),
    measuredExtensionIn: nonNegativeNumber(row.measuredExtensionIn),
    bumperEventRecorded: Boolean(row.bumperEventRecorded),
    solidCoreFoam: Boolean(row.solidCoreFoam),
    separateColorSets: Boolean(row.separateColorSets),
    bumperGapsOk: Boolean(row.bumperGapsOk),
    bumperNoElectronics: Boolean(row.bumperNoElectronics),
  };
}

/** Parse an untrusted wiring/power object from a request body into a typed WiringPowerSpec. */
export function parseWiringPower(value: unknown): WiringPowerSpec {
  const row = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    mainBreakerMaxAmps: nonNegativeNumber(row.mainBreakerMaxAmps),
    installedMainBreakerAmps: nonNegativeNumber(row.installedMainBreakerAmps),
    batterySecured: Boolean(row.batterySecured),
    wiresLabeled: Boolean(row.wiresLabeled),
    radioPowerOk: Boolean(row.radioPowerOk),
    bypassSwitchAccessible: Boolean(row.bypassSwitchAccessible),
    binderRecorded: Boolean(row.binderRecorded),
    bomPrinted: Boolean(row.bomPrinted),
    inspectionChecklistPrinted: Boolean(row.inspectionChecklistPrinted),
    studentCaptainPresent: Boolean(row.studentCaptainPresent),
    radioEventRecorded: Boolean(row.radioEventRecorded),
    radioOnMainPd: Boolean(row.radioOnMainPd),
    rioOnMainPd10A: Boolean(row.rioOnMainPd10A),
    radioProgrammedForEvent: Boolean(row.radioProgrammedForEvent),
    radioWeidmullerQc: Boolean(row.radioWeidmullerQc),
    sparkMaxEventRecorded: Boolean(row.sparkMaxEventRecorded),
    sparkMaxUsbAvoided: Boolean(row.sparkMaxUsbAvoided),
    reliabilityEventRecorded: Boolean(row.reliabilityEventRecorded),
    strainReliefOk: Boolean(row.strainReliefOk),
    dynamicCableClear: Boolean(row.dynamicCableClear),
    esdIntakeBonded: Boolean(row.esdIntakeBonded),
    esdShielded: Boolean(row.esdShielded),
    canivorePdhBackup: Boolean(row.canivorePdhBackup),
    batteryLeadsTorqued: Boolean(row.batteryLeadsTorqued),
    mainBreakerCovered: Boolean(row.mainBreakerCovered),
    rioUsbCameraClear: Boolean(row.rioUsbCameraClear),
    pneumaticsEventRecorded: Boolean(row.pneumaticsEventRecorded),
    ventPlugAccessible: Boolean(row.ventPlugAccessible),
    singleOnboardCompressor: Boolean(row.singleOnboardCompressor),
    reliefValveOnCompressor: Boolean(row.reliefValveOnCompressor),
    workingPressure60Psi: Boolean(row.workingPressure60Psi),
    pressureSwitchOnPcmPh: Boolean(row.pressureSwitchOnPcmPh),
    isolationEventRecorded: Boolean(row.isolationEventRecorded),
    frameIsolated120: Boolean(row.frameIsolated120),
    unusedPdPortsTaped: Boolean(row.unusedPdPortsTaped),
    rslEventRecorded: Boolean(row.rslEventRecorded),
    rslVisible36: Boolean(row.rslVisible36),
    rslOnRioPort: Boolean(row.rslOnRioPort),
  };
}

type CheckRow = {
  id: string;
  seasonYear: number;
  robotName: string;
  weightBudget: unknown;
  frameBumper: unknown;
  wiringPower: unknown;
  flags: unknown;
  riskScore: string;
  totalWeightLbs: string;
  summary: string;
  createdAt: string;
  updatedAt: string;
};

function mapCheck(row: CheckRow): InspectionCopilotCheck {
  return {
    id: row.id,
    seasonYear: row.seasonYear,
    robotName: row.robotName,
    weightBudget: parseWeightBudget(row.weightBudget),
    frameBumper: parseFrameBumper(row.frameBumper),
    wiringPower: parseWiringPower(row.wiringPower),
    flags: Array.isArray(row.flags) ? (row.flags as InspectionFlag[]) : [],
    riskScore: Number(row.riskScore) || 0,
    totalWeightLbs: Number(row.totalWeightLbs) || 0,
    summary: row.summary,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function resolveOrg(
  client: PoolClient,
  userId: string,
  requestedOrg: string | null,
): Promise<{ orgId: string; teamNumber: number | null } | null> {
  const membership = await client.query<{ orgId: string; teamNumber: number | null }>(
    `SELECT m.org_id AS "orgId", o.team_number AS "teamNumber"
     FROM memberships m
     JOIN organizations o ON o.id = m.org_id
     WHERE m.user_id = $1
       AND ($2::uuid IS NULL OR m.org_id = $2::uuid)
     ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, o.team_number
     LIMIT 1`,
    [userId, requestedOrg],
  );
  return membership.rows[0] ?? null;
}

export async function computeInspectionCopilotView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null; seasonYear?: number | null },
): Promise<InspectionCopilotView> {
  const org = await resolveOrg(client, input.userId, input.requestedOrg);
  const seasonYear = input.seasonYear && input.seasonYear > 2000 ? input.seasonYear : currentSeasonYear();

  if (!org) {
    return {
      status: "setup_required",
      message: "Select a team workspace to predict inspection failures before you travel.",
      steps: [
        {
          id: "workspace",
          label: "Select workspace",
          detail: "Inspection Copilot is org-scoped — pick a team before logging readiness checks.",
          href: "/workspace",
        },
        {
          id: "batteries",
          label: "Open Batteries",
          detail: "Pack health stays blank until logged — never DEMO IR or cycles.",
          href: "/team?tab=batteries",
        },
        {
          id: "fmea",
          label: "Open FMEA",
          detail: "Failure modes stay blank until scored — never DEMO RPN.",
          href: "/build?tab=fmea",
        },
        {
          id: "subsystems",
          label: "Open Subsystems",
          detail: "Subsystem names stay empty until you author them — never DEMO systems.",
          href: "/subsystems",
        },
      ],
      orgId: null,
      seasonYear,
    };
  }

  const [checkResult, seasonResult] = await Promise.all([
    client.query<CheckRow>(
      `SELECT id, season_year AS "seasonYear", robot_name AS "robotName",
              weight_budget AS "weightBudget", frame_bumper AS "frameBumper", wiring_power AS "wiringPower",
              flags, risk_score::text AS "riskScore", total_weight_lbs::text AS "totalWeightLbs", summary,
              created_at AS "createdAt", updated_at AS "updatedAt"
       FROM inspection_copilot_checks
       WHERE org_id = $1 AND season_year = $2
       ORDER BY created_at DESC`,
      [org.orgId, seasonYear],
    ),
    client.query<{ seasonYear: number }>(
      `SELECT DISTINCT season_year AS "seasonYear" FROM inspection_copilot_checks WHERE org_id = $1 ORDER BY season_year DESC`,
      [org.orgId],
    ),
  ]);

  const seasons = seasonResult.rows.map((r) => r.seasonYear);
  if (!seasons.includes(seasonYear)) seasons.unshift(seasonYear);

  return {
    status: "live",
    orgId: org.orgId,
    teamNumber: org.teamNumber,
    seasonYear,
    seasons,
    checks: checkResult.rows.map(mapCheck),
    computedAt: new Date().toISOString(),
  };
}

// ---- write helpers (run inside the caller's withRls transaction) ----

export async function logCheck(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    seasonYear: number;
    robotName: string;
    weightBudget: WeightBudgetSpec;
    frameBumper: FrameBumperSpec;
    wiringPower: WiringPowerSpec;
  },
): Promise<void> {
  const prediction = await meteredAI({
    client,
    orgId: input.orgId,
    userId: input.userId,
    feature: "inspection_copilot",
    requestId: `inspection-copilot-${randomUUID()}`,
    estimatedCostUsd: 0,
    keySource: "local_cli",
    metadata: {
      robotName: input.robotName,
      seasonYear: input.seasonYear,
      itemCount: input.weightBudget.items.length,
      note: "Deterministic weight-budget vs frame/bumper vs wiring-power diff — no external model call",
    },
    invoke: async () => ({
      value: predictInspectionFailures({
        weightBudget: input.weightBudget,
        frameBumper: input.frameBumper,
        wiringPower: input.wiringPower,
      }),
      promptTokens: 0,
      completionTokens: 0,
      costUsd: 0,
      model: "vantage-inspection-copilot-v1",
      provider: "vantage-local",
    }),
  });

  await client.query(
    `INSERT INTO inspection_copilot_checks (
       org_id, season_year, robot_name, weight_budget, frame_bumper, wiring_power,
       flags, risk_score, total_weight_lbs, summary, created_by
     ) VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb,$7::jsonb,$8,$9,$10,$11)`,
    [
      input.orgId,
      input.seasonYear,
      input.robotName,
      JSON.stringify(input.weightBudget),
      JSON.stringify(input.frameBumper),
      JSON.stringify(input.wiringPower),
      JSON.stringify(prediction.flags),
      prediction.riskScore,
      prediction.totalWeightLbs,
      prediction.summary,
      input.userId,
    ],
  );
}

export async function deleteCheck(
  client: PoolClient,
  input: { orgId: string; checkId: string },
): Promise<void> {
  await client.query(`DELETE FROM inspection_copilot_checks WHERE id = $1 AND org_id = $2`, [
    input.checkId,
    input.orgId,
  ]);
}
