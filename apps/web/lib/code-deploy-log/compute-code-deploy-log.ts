import type { PoolClient } from "@neondatabase/serverless";
import { DEPLOY_STATUSES, DEPLOY_TYPES, summarizeDeployLog } from ".";
import type { CodeDeployLogEntry, CodeDeployLogSummary, DeployStatus, DeployType } from "./types";

export { DEPLOY_STATUSES, DEPLOY_TYPES };

export type CodeDeployLogSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export type CodeDeployLogView =
  | {
      status: "setup_required";
      message: string;
      steps: CodeDeployLogSetupStep[];
      orgId: string | null;
      seasonYear: number;
    }
  | {
      status: "live";
      orgId: string;
      teamNumber: number | null;
      seasonYear: number;
      seasons: number[];
      entries: CodeDeployLogEntry[];
      summary: CodeDeployLogSummary;
      computedAt: string;
    };

export function currentSeasonYear(now: Date = new Date()): number {
  return now.getUTCFullYear();
}

function isDeployType(value: unknown): value is DeployType {
  return typeof value === "string" && (DEPLOY_TYPES as string[]).includes(value);
}

function isDeployStatus(value: unknown): value is DeployStatus {
  return typeof value === "string" && (DEPLOY_STATUSES as string[]).includes(value);
}

type EntryRow = {
  id: string;
  seasonYear: number;
  deployedOn: string;
  matchKey: string | null;
  eventKey: string | null;
  firmwareVersion: string;
  commitSha: string | null;
  branch: string | null;
  deployType: string;
  status: string;
  notes: string | null;
  createdAt: string;
};

function mapEntry(row: EntryRow): CodeDeployLogEntry {
  return {
    id: row.id,
    seasonYear: row.seasonYear,
    deployedOn: row.deployedOn,
    matchKey: row.matchKey,
    eventKey: row.eventKey,
    firmwareVersion: row.firmwareVersion,
    commitSha: row.commitSha,
    branch: row.branch,
    deployType: isDeployType(row.deployType) ? row.deployType : "practice",
    status: isDeployStatus(row.status) ? row.status : "deployed",
    notes: row.notes,
    createdAt: row.createdAt,
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

export async function computeCodeDeployLogView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null; seasonYear?: number | null },
): Promise<CodeDeployLogView> {
  const org = await resolveOrg(client, input.userId, input.requestedOrg);
  const seasonYear = input.seasonYear && input.seasonYear > 2000 ? input.seasonYear : currentSeasonYear();

  if (!org) {
    return {
      status: "setup_required",
      message: "Select a team to log robot code deploys.",
      steps: [
        { id: "workspace", label: "Choose your team", detail: "Pick which FRC team you are working as.", href: "/workspace" },
      ],
      orgId: null,
      seasonYear,
    };
  }

  const [entryResult, seasonResult] = await Promise.all([
    client.query<EntryRow>(
      `SELECT id, season_year AS "seasonYear", deployed_on::text AS "deployedOn", match_key AS "matchKey",
              event_key AS "eventKey", firmware_version AS "firmwareVersion", commit_sha AS "commitSha",
              branch, deploy_type AS "deployType", status, notes, created_at AS "createdAt"
       FROM code_deploy_log_entries
       WHERE org_id = $1 AND season_year = $2
       ORDER BY deployed_on DESC, created_at DESC`,
      [org.orgId, seasonYear],
    ),
    client.query<{ seasonYear: number }>(
      `SELECT DISTINCT season_year AS "seasonYear" FROM code_deploy_log_entries WHERE org_id = $1 ORDER BY season_year DESC`,
      [org.orgId],
    ),
  ]);

  const entries = entryResult.rows.map(mapEntry);
  const summary = summarizeDeployLog(entries);
  const seasons = seasonResult.rows.map((r) => r.seasonYear);
  if (!seasons.includes(seasonYear)) seasons.unshift(seasonYear);

  return {
    status: "live",
    orgId: org.orgId,
    teamNumber: org.teamNumber,
    seasonYear,
    seasons,
    entries,
    summary,
    computedAt: new Date().toISOString(),
  };
}

// ---- write helpers (run inside the caller's withRls transaction) ----

export async function logDeploy(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    seasonYear: number;
    deployedOn: string;
    matchKey: string | null;
    eventKey: string | null;
    firmwareVersion: string;
    commitSha: string | null;
    branch: string | null;
    deployType: DeployType;
    status: DeployStatus;
    notes: string | null;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO code_deploy_log_entries (
       org_id, season_year, deployed_on, match_key, event_key, firmware_version, commit_sha,
       branch, deploy_type, status, notes, deployed_by
     ) VALUES ($1,$2,$3::date,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [
      input.orgId,
      input.seasonYear,
      input.deployedOn,
      input.matchKey,
      input.eventKey,
      input.firmwareVersion,
      input.commitSha,
      input.branch,
      input.deployType,
      input.status,
      input.notes,
      input.userId,
    ],
  );
}

export async function deleteDeploy(
  client: PoolClient,
  input: { orgId: string; entryId: string },
): Promise<void> {
  await client.query(`DELETE FROM code_deploy_log_entries WHERE id = $1 AND org_id = $2`, [
    input.entryId,
    input.orgId,
  ]);
}
