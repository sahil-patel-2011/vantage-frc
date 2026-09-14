import type { PoolClient } from "@neondatabase/serverless";
import { diffSchemaFields, summarizeScoutSchemaNegotiate } from ".";
import type {
  ScoutSchemaNegotiateSummary,
  ScoutSchemaSubmission,
  ScoutSchemaVersion,
  SubmissionStatus,
} from "./types";
import { resolveScoutOrg } from "../scout-org-access";

export type ScoutSchemaNegotiateSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export type ScoutSchemaNegotiateView =
  | {
      status: "setup_required";
      message: string;
      steps: ScoutSchemaNegotiateSetupStep[];
      orgId: string | null;
    }
  | {
      status: "live";
      orgId: string;
      teamNumber: number | null;
      versions: ScoutSchemaVersion[];
      submissions: ScoutSchemaSubmission[];
      summary: ScoutSchemaNegotiateSummary;
      computedAt: string;
    };

type VersionRow = {
  id: string;
  versionTag: string;
  fieldKeys: string[] | null;
  isActive: boolean;
  notes: string | null;
  createdAt: string;
};

function mapVersion(row: VersionRow): ScoutSchemaVersion {
  return {
    id: row.id,
    versionTag: row.versionTag,
    fieldKeys: Array.isArray(row.fieldKeys) ? row.fieldKeys : [],
    isActive: row.isActive,
    notes: row.notes,
    createdAt: row.createdAt,
  };
}

type SubmissionRow = {
  id: string;
  deviceId: string;
  schemaVersion: string;
  matchNumber: number | null;
  teamNumber: number | null;
  rawPayload: Record<string, unknown> | null;
  status: SubmissionStatus;
  missingFields: string[] | null;
  extraFields: string[] | null;
  notes: string | null;
  submittedAt: string;
  reconciledAt: string | null;
};

function mapSubmission(row: SubmissionRow): ScoutSchemaSubmission {
  return {
    id: row.id,
    deviceId: row.deviceId,
    schemaVersion: row.schemaVersion,
    matchNumber: row.matchNumber,
    teamNumber: row.teamNumber,
    rawPayload: row.rawPayload && typeof row.rawPayload === "object" ? row.rawPayload : {},
    status: row.status,
    missingFields: Array.isArray(row.missingFields) ? row.missingFields : [],
    extraFields: Array.isArray(row.extraFields) ? row.extraFields : [],
    notes: row.notes,
    submittedAt: row.submittedAt,
    reconciledAt: row.reconciledAt,
  };
}

async function resolveOrg(
  client: PoolClient,
  userId: string,
  requestedOrg: string | null,
) {
  return resolveScoutOrg(client, userId, requestedOrg);
}

export async function computeScoutSchemaNegotiateView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null },
): Promise<ScoutSchemaNegotiateView> {
  const org = await resolveOrg(client, input.userId, input.requestedOrg);

  if (!org) {
    return {
      status: "setup_required",
      message: "Choose your team to negotiate scouting schema versions.",
      steps: [
        { id: "workspace", label: "Choose your team", detail: "Choose which FRC team you are working as.", href: "/workspace" },
      ],
      orgId: null,
    };
  }

  const [versionResult, submissionResult] = await Promise.all([
    client.query<VersionRow>(
      `SELECT id, version_tag AS "versionTag", field_keys AS "fieldKeys", is_active AS "isActive",
              notes, created_at::text AS "createdAt"
       FROM scout_schema_negotiate_versions
       WHERE org_id = $1
       ORDER BY created_at DESC`,
      [org.orgId],
    ),
    client.query<SubmissionRow>(
      `SELECT id, device_id AS "deviceId", schema_version AS "schemaVersion",
              match_number AS "matchNumber", team_number AS "teamNumber", raw_payload AS "rawPayload",
              status, missing_fields AS "missingFields", extra_fields AS "extraFields", notes,
              submitted_at::text AS "submittedAt", reconciled_at::text AS "reconciledAt"
       FROM scout_schema_negotiate_submissions
       WHERE org_id = $1
       ORDER BY submitted_at DESC
       LIMIT 200`,
      [org.orgId],
    ),
  ]);

  const versions = versionResult.rows.map(mapVersion);
  const submissions = submissionResult.rows.map(mapSubmission);
  const summary = summarizeScoutSchemaNegotiate(submissions, versions);

  return {
    status: "live",
    orgId: org.orgId,
    teamNumber: org.teamNumber,
    versions,
    submissions,
    summary,
    computedAt: new Date().toISOString(),
  };
}

// ---- write helpers (run inside the caller's withRls transaction) ----

export async function registerSchemaVersion(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    versionTag: string;
    fieldKeys: string[];
    makeActive: boolean;
    notes: string | null;
  },
): Promise<void> {
  if (input.makeActive) {
    await client.query(
      `UPDATE scout_schema_negotiate_versions SET is_active = false WHERE org_id = $1`,
      [input.orgId],
    );
  }
  await client.query(
    `INSERT INTO scout_schema_negotiate_versions (org_id, version_tag, field_keys, is_active, notes, created_by)
     VALUES ($1,$2,$3::text[],$4,$5,$6)
     ON CONFLICT (org_id, version_tag)
     DO UPDATE SET field_keys = EXCLUDED.field_keys, is_active = EXCLUDED.is_active, notes = EXCLUDED.notes`,
    [input.orgId, input.versionTag, input.fieldKeys, input.makeActive, input.notes, input.userId],
  );
}

export async function submitEntry(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    deviceId: string;
    schemaVersion: string;
    matchNumber: number | null;
    teamNumber: number | null;
    rawPayload: Record<string, unknown>;
  },
): Promise<void> {
  const activeResult = await client.query<{ fieldKeys: string[] | null }>(
    `SELECT field_keys AS "fieldKeys" FROM scout_schema_negotiate_versions WHERE org_id = $1 AND is_active = true LIMIT 1`,
    [input.orgId],
  );
  const activeFieldKeys = Array.isArray(activeResult.rows[0]?.fieldKeys) ? activeResult.rows[0].fieldKeys : [];
  const submittedFieldKeys = Object.keys(input.rawPayload);
  const { missing, extra } = diffSchemaFields(activeFieldKeys, submittedFieldKeys);

  await client.query(
    `INSERT INTO scout_schema_negotiate_submissions (
       org_id, device_id, schema_version, match_number, team_number, raw_payload,
       status, missing_fields, extra_fields, submitted_by
     ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,'pending',$7::text[],$8::text[],$9)`,
    [
      input.orgId,
      input.deviceId,
      input.schemaVersion,
      input.matchNumber,
      input.teamNumber,
      JSON.stringify(input.rawPayload ?? {}),
      missing,
      extra,
      input.userId,
    ],
  );
}

export async function reconcileSubmission(
  client: PoolClient,
  input: { orgId: string; submissionId: string; notes: string | null },
): Promise<void> {
  await client.query(
    `UPDATE scout_schema_negotiate_submissions
     SET status = 'reconciled', reconciled_at = now(), notes = COALESCE($3, notes)
     WHERE id = $1 AND org_id = $2`,
    [input.submissionId, input.orgId, input.notes],
  );
}

export async function rejectSubmission(
  client: PoolClient,
  input: { orgId: string; submissionId: string; notes: string | null },
): Promise<void> {
  await client.query(
    `UPDATE scout_schema_negotiate_submissions
     SET status = 'rejected', reconciled_at = now(), notes = COALESCE($3, notes)
     WHERE id = $1 AND org_id = $2`,
    [input.submissionId, input.orgId, input.notes],
  );
}
