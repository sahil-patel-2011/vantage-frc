import { randomUUID } from "node:crypto";
import type { PoolClient } from "@neondatabase/serverless";
import { meteredAI } from "@vantage/billing";
import { CODE_VERSION_STATUSES, WIRING_STATUSES, computeReadinessIndex, subsystemHealthScore } from ".";
import { hubHref } from "../nav/hubs";
import { withOrgHref } from "../nav/product-nav";
import type {
  CodeVersionStatus,
  ReadinessChecklistItem,
  ReadinessFmeaRef,
  ReadinessIndex,
  ReadinessSubsystem,
  WiringStatus,
} from "./types";

export { CODE_VERSION_STATUSES, WIRING_STATUSES };

export type ReadinessScoreSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

/** Soft-UI setup steps — hubHref / withOrgHref only; never DEMO readiness metrics. */
function setupSteps(orgId: string | null): ReadinessScoreSetupStep[] {
  return [
    {
      id: "workspace",
      label: "Select workspace",
      detail: "Choose your team organization — Readiness Score is org-scoped.",
      href: orgId ? withOrgHref("/workspace", orgId) : "/workspace",
    },
    {
      id: "fmea",
      label: "Open FMEA",
      detail: "Open failure modes stay blank until real rows exist — never DEMO RPN.",
      href: hubHref("/build", "fmea", orgId),
    },
    {
      id: "inspection-copilot",
      label: "Open Inspection Copilot",
      detail: "Inspection readiness stays blank until measurements exist — never DEMO risk.",
      href: hubHref("/build", "inspection-copilot", orgId),
    },
  ];
}

export type ReadinessScoreView =
  | {
      status: "setup_required";
      message: string;
      steps: ReadinessScoreSetupStep[];
      orgId: string | null;
      seasonYear: number;
    }
  | {
      status: "live";
      orgId: string;
      teamNumber: number | null;
      seasonYear: number;
      seasons: number[];
      subsystems: ReadinessSubsystem[];
      checklistItems: ReadinessChecklistItem[];
      openFmeaFailures: ReadinessFmeaRef[];
      index: ReadinessIndex;
      computedAt: string;
    };

export function currentSeasonYear(now: Date = new Date()): number {
  return now.getUTCFullYear();
}

export function isWiringStatus(value: unknown): value is WiringStatus {
  return typeof value === "string" && (WIRING_STATUSES as string[]).includes(value);
}

export function isCodeVersionStatus(value: unknown): value is CodeVersionStatus {
  return typeof value === "string" && (CODE_VERSION_STATUSES as string[]).includes(value);
}

type SubsystemRow = {
  id: string;
  name: string;
  weightLbs: string;
  powerDrawAmps: string;
  wiringStatus: string;
  codeVersionStatus: string;
  healthScore: string;
  notes: string | null;
  updatedAt: string;
};

function mapSubsystem(row: SubsystemRow): ReadinessSubsystem {
  return {
    id: row.id,
    name: row.name,
    weightLbs: Number(row.weightLbs) || 0,
    powerDrawAmps: Number(row.powerDrawAmps) || 0,
    wiringStatus: isWiringStatus(row.wiringStatus) ? row.wiringStatus : "not_started",
    codeVersionStatus: isCodeVersionStatus(row.codeVersionStatus) ? row.codeVersionStatus : "stale",
    healthScore: Number(row.healthScore) || 0,
    notes: row.notes,
    updatedAt: row.updatedAt,
  };
}

type ChecklistRow = {
  id: string;
  subsystemName: string | null;
  label: string;
  isComplete: boolean;
  sequence: number;
  createdAt: string;
};

function mapChecklistItem(row: ChecklistRow): ReadinessChecklistItem {
  return {
    id: row.id,
    subsystemName: row.subsystemName,
    label: row.label,
    isComplete: Boolean(row.isComplete),
    sequence: Number(row.sequence) || 0,
    createdAt: row.createdAt,
  };
}

type FmeaRow = {
  id: string;
  title: string;
  subsystemName: string;
  severity: number;
  occurrence: number;
  detection: number;
  status: string;
};

function mapFmea(row: FmeaRow): ReadinessFmeaRef {
  return {
    id: row.id,
    title: row.title,
    subsystemName: row.subsystemName,
    severity: Number(row.severity) || 0,
    occurrence: Number(row.occurrence) || 0,
    detection: Number(row.detection) || 0,
    status: row.status,
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

export async function computeReadinessScoreView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null; seasonYear?: number | null },
): Promise<ReadinessScoreView> {
  const org = await resolveOrg(client, input.userId, input.requestedOrg);
  const seasonYear = input.seasonYear && input.seasonYear > 2000 ? input.seasonYear : currentSeasonYear();

  if (!org) {
    return {
      status: "setup_required",
      message: "Select a team workspace to track robot readiness.",
      steps: setupSteps(null),
      orgId: null,
      seasonYear,
    };
  }

  const [subsystemResult, checklistResult, fmeaResult, seasonResult] = await Promise.all([
    client.query<SubsystemRow>(
      `SELECT id, name, weight_lbs::text AS "weightLbs", power_draw_amps::text AS "powerDrawAmps",
              wiring_status AS "wiringStatus", code_version_status AS "codeVersionStatus",
              health_score::text AS "healthScore", notes, updated_at::text AS "updatedAt"
       FROM readiness_score_subsystems
       WHERE org_id = $1 AND season_year = $2
       ORDER BY name`,
      [org.orgId, seasonYear],
    ),
    client.query<ChecklistRow>(
      `SELECT id, subsystem_name AS "subsystemName", label, is_complete AS "isComplete",
              sequence, created_at::text AS "createdAt"
       FROM readiness_score_checklist_items
       WHERE org_id = $1 AND season_year = $2
       ORDER BY sequence, created_at`,
      [org.orgId, seasonYear],
    ),
    client.query<FmeaRow>(
      `SELECT id, title, subsystem_name AS "subsystemName", severity, occurrence, detection, status
       FROM fmea_failures
       WHERE org_id = $1 AND season_year = $2 AND status IN ('open', 'fixing')
       ORDER BY (occurrence * severity * detection) DESC
       LIMIT 50`,
      [org.orgId, seasonYear],
    ),
    client.query<{ seasonYear: number }>(
      `SELECT DISTINCT season_year AS "seasonYear" FROM readiness_score_subsystems WHERE org_id = $1 ORDER BY season_year DESC`,
      [org.orgId],
    ),
  ]);

  const subsystems = subsystemResult.rows.map(mapSubsystem);
  const checklistItems = checklistResult.rows.map(mapChecklistItem);
  const openFmeaFailures = fmeaResult.rows.map(mapFmea);
  const seasons = seasonResult.rows.map((r) => r.seasonYear);
  if (!seasons.includes(seasonYear)) seasons.unshift(seasonYear);

  const index = computeReadinessIndex({ subsystems, checklistItems, openFmeaFailures });

  return {
    status: "live",
    orgId: org.orgId,
    teamNumber: org.teamNumber,
    seasonYear,
    seasons,
    subsystems,
    checklistItems,
    openFmeaFailures,
    index,
    computedAt: new Date().toISOString(),
  };
}

// ---- write helpers (run inside the caller's withRls transaction) ----

export async function saveSubsystem(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    seasonYear: number;
    name: string;
    weightLbs: number;
    powerDrawAmps: number;
    wiringStatus: WiringStatus;
    codeVersionStatus: CodeVersionStatus;
    notes: string | null;
  },
): Promise<void> {
  const scored = await meteredAI({
    client,
    orgId: input.orgId,
    userId: input.userId,
    feature: "readiness_score",
    requestId: `readiness-score-${randomUUID()}`,
    estimatedCostUsd: 0,
    keySource: "local_cli",
    metadata: {
      subsystemName: input.name,
      seasonYear: input.seasonYear,
      note: "Deterministic wiring/code-version health scoring — no external model call",
    },
    invoke: async () => ({
      value: subsystemHealthScore({
        wiringStatus: input.wiringStatus,
        codeVersionStatus: input.codeVersionStatus,
      }),
      promptTokens: 0,
      completionTokens: 0,
      costUsd: 0,
      model: "vantage-readiness-score-v1",
      provider: "vantage-local",
    }),
  });

  await client.query(
    `INSERT INTO readiness_score_subsystems (
       org_id, season_year, name, weight_lbs, power_draw_amps, wiring_status,
       code_version_status, health_score, notes, updated_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (org_id, season_year, name) DO UPDATE SET
       weight_lbs = EXCLUDED.weight_lbs,
       power_draw_amps = EXCLUDED.power_draw_amps,
       wiring_status = EXCLUDED.wiring_status,
       code_version_status = EXCLUDED.code_version_status,
       health_score = EXCLUDED.health_score,
       notes = EXCLUDED.notes,
       updated_by = EXCLUDED.updated_by,
       updated_at = now()`,
    [
      input.orgId,
      input.seasonYear,
      input.name,
      input.weightLbs,
      input.powerDrawAmps,
      input.wiringStatus,
      input.codeVersionStatus,
      scored,
      input.notes,
      input.userId,
    ],
  );
}

export async function deleteSubsystem(
  client: PoolClient,
  input: { orgId: string; subsystemId: string },
): Promise<void> {
  await client.query(`DELETE FROM readiness_score_subsystems WHERE id = $1 AND org_id = $2`, [
    input.subsystemId,
    input.orgId,
  ]);
}

export async function addChecklistItem(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    seasonYear: number;
    label: string;
    subsystemName: string | null;
    sequence: number;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO readiness_score_checklist_items (
       org_id, season_year, subsystem_name, label, sequence, created_by
     ) VALUES ($1,$2,$3,$4,$5,$6)`,
    [input.orgId, input.seasonYear, input.subsystemName, input.label, input.sequence, input.userId],
  );
}

export async function toggleChecklistItem(
  client: PoolClient,
  input: { orgId: string; itemId: string; isComplete: boolean },
): Promise<void> {
  await client.query(
    `UPDATE readiness_score_checklist_items
     SET is_complete = $1, completed_at = CASE WHEN $1 THEN now() ELSE NULL END
     WHERE id = $2 AND org_id = $3`,
    [input.isComplete, input.itemId, input.orgId],
  );
}

export async function deleteChecklistItem(
  client: PoolClient,
  input: { orgId: string; itemId: string },
): Promise<void> {
  await client.query(`DELETE FROM readiness_score_checklist_items WHERE id = $1 AND org_id = $2`, [
    input.itemId,
    input.orgId,
  ]);
}
