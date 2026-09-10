import type { PoolClient } from "@neondatabase/serverless";
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

/**
 * Readiness Score is a read model, not a place a team enters data.
 *
 * It used to own `readiness_score_subsystems`: a fourth copy of the subsystem
 * list carrying its own weight, power, wiring and code-version columns. Nothing
 * kept that copy in step with the tools that actually hold those numbers, so a
 * team that used the rest of the build season correctly — spec sheet, weight
 * budget, power budget, sign-off gates — got `weight 0/115, power 0/120,
 * subsystems 0` here, and a score computed from an FMEA row alone. Worse, the
 * missing data read as *good news*: with nothing recorded, weight and power
 * headroom both scored a perfect 1.0, so the index went up the less the team
 * had entered.
 *
 * Every number below is now read from the one place the team maintains it:
 *   roster          robot_subsystems (0104), plus any subsystem tracked only in
 *                   subsystem_signoff_subsystems (0267)
 *   weight          weight_components (0110), quantity-weighted
 *   weight budget   weight_settings.limit_lbs — the team's real configured limit
 *   power           power_loads.typical_amps (0107)
 *   wiring / code   the latest subsystem_signoff_records gate decision (0267)
 *   open failures   fmea_failures (0153)
 * The bring-up checklist stays owned here — it is genuinely readiness's own.
 */

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
      detail: "Choose your team organization to open Readiness Score.",
      href: orgId ? withOrgHref("/workspace", orgId) : "/workspace",
    },
    {
      id: "subsystems",
      label: "Open Subsystems",
      detail: "The subsystem spec sheet is the roster this score reads — nothing is retyped here.",
      href: hubHref("/build", "subsystems", orgId),
    },
    {
      id: "fmea",
      label: "Open FMEA",
      detail: "Open failure modes stay blank until real rows exist.",
      href: hubHref("/build", "fmea", orgId),
    },
    {
      id: "inspection-copilot",
      label: "Open Inspection Copilot",
      detail: "Inspection readiness stays blank until measurements exist.",
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
      /** Where each column of the roster is actually maintained. */
      sources: { id: string; label: string; href: string }[];
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

/** Free-text subsystem labels are matched case-insensitively across the build tools. */
function key(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * A signed-off wiring gate is verified wiring. A rejected gate means it was
 * reviewed and sent back — work is under way, not untouched. No record at all
 * means nobody has reviewed it, which is where every subsystem starts.
 */
function wiringFromGate(decision: string | null): WiringStatus {
  if (decision === "approved") return "verified";
  if (decision === "rejected") return "in_progress";
  return "not_started";
}

function codeFromGate(decision: string | null): CodeVersionStatus {
  if (decision === "approved") return "deployed_tested";
  if (decision === "rejected") return "building";
  return "stale";
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

type RosterRow = {
  id: string;
  name: string;
  notes: string | null;
  updatedAt: string;
};

type NumericBySubsystem = { subsystem: string; total: string };

type GateRow = { name: string; gate: string; decision: string };

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

  const [
    rosterResult,
    weightResult,
    weightLimitResult,
    powerResult,
    gateResult,
    checklistResult,
    fmeaResult,
    seasonResult,
  ] = await Promise.all([
    // The spec sheet is the roster. A subsystem that exists only as a sign-off
    // record still belongs on the list — it is being gated, so it is being built.
    client.query<RosterRow>(
      `SELECT id, name, NULLIF(notes, '') AS notes, updated_at::text AS "updatedAt"
         FROM robot_subsystems
        WHERE org_id = $1::uuid AND season_year = $2::int
        UNION ALL
       SELECT s.id, s.name, s.notes, s.created_at::text AS "updatedAt"
         FROM subsystem_signoff_subsystems s
        WHERE s.org_id = $1::uuid AND s.season_year = $2::int
          AND NOT EXISTS (
                SELECT 1 FROM robot_subsystems r
                 WHERE r.org_id = s.org_id AND r.season_year = s.season_year
                   AND lower(btrim(r.name)) = lower(btrim(s.name))
              )`,
      [org.orgId, seasonYear],
    ),
    client.query<NumericBySubsystem>(
      `SELECT btrim(subsystem) AS subsystem, SUM(weight_lbs * quantity)::text AS total
         FROM weight_components
        WHERE org_id = $1::uuid AND season_year = $2::int
        GROUP BY btrim(subsystem)`,
      [org.orgId, seasonYear],
    ),
    client.query<{ limitLbs: string }>(
      `SELECT limit_lbs::text AS "limitLbs" FROM weight_settings
        WHERE org_id = $1::uuid AND season_year = $2::int`,
      [org.orgId, seasonYear],
    ),
    client.query<NumericBySubsystem>(
      `SELECT btrim(subsystem) AS subsystem, SUM(COALESCE(typical_amps, 0))::text AS total
         FROM power_loads
        WHERE org_id = $1::uuid AND season_year = $2::int
        GROUP BY btrim(subsystem)`,
      [org.orgId, seasonYear],
    ),
    // Latest decision per subsystem per gate — DISTINCT ON keyed by the same
    // name the roster uses, so a re-review supersedes the earlier record.
    client.query<GateRow>(
      `SELECT DISTINCT ON (lower(btrim(s.name)), r.gate)
              s.name, r.gate, r.decision
         FROM subsystem_signoff_records r
         JOIN subsystem_signoff_subsystems s ON s.id = r.subsystem_id
        WHERE r.org_id = $1::uuid AND s.season_year = $2::int
          AND r.gate = ANY($3::text[])
        ORDER BY lower(btrim(s.name)), r.gate, r.signed_on DESC, r.created_at DESC`,
      [org.orgId, seasonYear, ["wiring", "programming"]],
    ),
    client.query<ChecklistRow>(
      `SELECT id, subsystem_name AS "subsystemName", label, is_complete AS "isComplete",
              sequence, created_at::text AS "createdAt"
       FROM readiness_score_checklist_items
       WHERE org_id = $1::uuid AND season_year = $2::int
       ORDER BY sequence, created_at`,
      [org.orgId, seasonYear],
    ),
    client.query<FmeaRow>(
      `SELECT id, title, subsystem_name AS "subsystemName", severity, occurrence, detection, status
       FROM fmea_failures
       WHERE org_id = $1::uuid AND season_year = $2::int AND status IN ('open', 'fixing')
       ORDER BY (occurrence * severity * detection) DESC
       LIMIT 50`,
      [org.orgId, seasonYear],
    ),
    // Seasons the team has any build data for, so the season switcher is real.
    client.query<{ seasonYear: number }>(
      `SELECT DISTINCT season_year AS "seasonYear" FROM (
         SELECT season_year FROM robot_subsystems WHERE org_id = $1::uuid
         UNION ALL SELECT season_year FROM weight_components WHERE org_id = $1::uuid
         UNION ALL SELECT season_year FROM power_loads WHERE org_id = $1::uuid
         UNION ALL SELECT season_year FROM subsystem_signoff_subsystems WHERE org_id = $1::uuid
         UNION ALL SELECT season_year FROM readiness_score_checklist_items WHERE org_id = $1::uuid
       ) seasons ORDER BY 1 DESC`,
      [org.orgId],
    ),
  ]);

  const weightBySubsystem = new Map<string, number>();
  let weightUsedLbs = 0;
  for (const row of weightResult.rows) {
    const value = Number(row.total) || 0;
    weightUsedLbs += value;
    if (row.subsystem) weightBySubsystem.set(key(row.subsystem), value);
  }

  const powerBySubsystem = new Map<string, number>();
  let powerUsedAmps = 0;
  for (const row of powerResult.rows) {
    const value = Number(row.total) || 0;
    powerUsedAmps += value;
    if (row.subsystem) powerBySubsystem.set(key(row.subsystem), value);
  }

  const wiringGates = new Map<string, string>();
  const codeGates = new Map<string, string>();
  for (const row of gateResult.rows) {
    const target = row.gate === "wiring" ? wiringGates : codeGates;
    target.set(key(row.name), row.decision);
  }

  const subsystems: ReadinessSubsystem[] = rosterResult.rows.map((row) => {
    const k = key(row.name);
    const wiringStatus = wiringFromGate(wiringGates.get(k) ?? null);
    const codeVersionStatus = codeFromGate(codeGates.get(k) ?? null);
    return {
      id: row.id,
      name: row.name,
      weightLbs: weightBySubsystem.get(k) ?? 0,
      powerDrawAmps: powerBySubsystem.get(k) ?? 0,
      wiringStatus,
      codeVersionStatus,
      healthScore: subsystemHealthScore({ wiringStatus, codeVersionStatus }),
      notes: row.notes,
      updatedAt: row.updatedAt,
    };
  });
  subsystems.sort((a, b) => a.name.localeCompare(b.name));

  const checklistItems = checklistResult.rows.map(mapChecklistItem);
  const openFmeaFailures = fmeaResult.rows.map(mapFmea);
  const seasons = seasonResult.rows.map((r) => Number(r.seasonYear));
  if (!seasons.includes(seasonYear)) seasons.unshift(seasonYear);

  // The team's own configured limit when they have set one. The FRC default is
  // only the fallback, and computeReadinessIndex names which one it used.
  const configuredLimit = Number(weightLimitResult.rows[0]?.limitLbs);

  const index = computeReadinessIndex({
    subsystems,
    checklistItems,
    openFmeaFailures,
    weightBudgetLbs: Number.isFinite(configuredLimit) && configuredLimit > 0 ? configuredLimit : undefined,
    // Totals cover every recorded line, including ones (bumpers, battery, wiring
    // harness) that carry no subsystem label — attributing only matched rows
    // would quietly understate the budget.
    weightUsedLbs,
    powerUsedAmps,
  });

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
    sources: [
      { id: "subsystems", label: "Subsystem roster & notes", href: hubHref("/build", "subsystems", org.orgId) },
      { id: "weight-budget", label: "Weight per subsystem", href: hubHref("/build", "weight-budget", org.orgId) },
      { id: "power-budget", label: "Current draw per subsystem", href: hubHref("/build", "power-budget", org.orgId) },
      {
        id: "subsystem-signoff",
        label: "Wiring & programming gates",
        href: hubHref("/build", "subsystem-signoff", org.orgId),
      },
      { id: "fmea", label: "Open failure modes", href: hubHref("/build", "fmea", org.orgId) },
    ],
    computedAt: new Date().toISOString(),
  };
}

// ---- write helpers (run inside the caller's withRls transaction) ----
//
// Only the bring-up checklist is written here. Subsystems, weight, power and the
// wiring/programming gates are edited in the tools that own them; see `sources`
// on the live view for where each one lives.

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
     ) VALUES ($1::uuid,$2::int,$3,$4,$5::int,$6::uuid)`,
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
     WHERE id = $2::uuid AND org_id = $3::uuid`,
    [input.isComplete, input.itemId, input.orgId],
  );
}

export async function deleteChecklistItem(
  client: PoolClient,
  input: { orgId: string; itemId: string },
): Promise<void> {
  await client.query(`DELETE FROM readiness_score_checklist_items WHERE id = $1::uuid AND org_id = $2::uuid`, [
    input.itemId,
    input.orgId,
  ]);
}
