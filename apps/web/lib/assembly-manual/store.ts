import type { PoolClient } from "@neondatabase/serverless";

/**
 * Every database read and write for the assembly manual, in one place.
 *
 * Request paths call these with the `withRls` client, so RLS decides what an
 * org can see. The worker calls the same functions with its own client; it
 * bypasses RLS by role, which is why the worker functions take an explicit
 * `orgId` from the row it already leased rather than trusting anything it was
 * handed.
 *
 * Note what is NOT here: no function returns a step's PNG alongside the step
 * list. A 200-step manual is tens of megabytes of images and paging them into a
 * JSON response would time out. Images are fetched one at a time by step.
 */

export class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "HttpError";
  }
}

export function failResponse(error: unknown, fallback: string): Response {
  if (error instanceof HttpError) return Response.json({ error: error.message }, { status: error.status });
  return Response.json(
    { error: error instanceof Error && error.message ? error.message : fallback },
    { status: 500 },
  );
}

export type Membership = { orgId: string; orgName: string; role: string };

export async function resolveMembership(client: PoolClient, userId: string): Promise<Membership> {
  const result = await client.query<Membership>(
    `SELECT m.org_id AS "orgId", o.name AS "orgName", m.role
       FROM memberships m JOIN organizations o ON o.id = m.org_id
      WHERE m.user_id = $1::uuid
      ORDER BY o.name
      LIMIT 1`,
    [userId],
  );
  const membership = result.rows[0];
  if (!membership) throw new HttpError(403, "Organization membership required");
  return membership;
}

export function requireLead(membership: Membership): void {
  if (membership.role !== "owner" && membership.role !== "admin") {
    throw new HttpError(403, "Only owners and admins can start an assembly manual run");
  }
}

export type RunStatus = "queued" | "running" | "paused" | "completed" | "failed" | "cancelled";

export type RunRow = {
  id: string;
  orgId: string;
  startedBy: string;
  startedByName: string | null;
  sourceKind: "vault" | "url";
  sourceDocumentId: string | null;
  onshapeUrl: string;
  documentId: string;
  workspaceId: string;
  elementId: string;
  assemblyName: string;
  status: RunStatus;
  progress: Record<string, unknown>;
  report: Record<string, unknown> | null;
  error: string | null;
  pdfByteSize: number | null;
  cancelRequestedAt: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
};

const RUN_COLUMNS = `
  r.id, r.org_id AS "orgId", r.started_by AS "startedBy",
  u.name AS "startedByName",
  r.source_kind AS "sourceKind", r.source_document_id AS "sourceDocumentId",
  r.onshape_url AS "onshapeUrl", r.document_id AS "documentId",
  r.workspace_id AS "workspaceId", r.element_id AS "elementId",
  r.assembly_name AS "assemblyName", r.status,
  r.progress, r.report, r.error,
  r.pdf_byte_size AS "pdfByteSize",
  r.cancel_requested_at::text AS "cancelRequestedAt",
  r.created_at::text AS "createdAt", r.started_at::text AS "startedAt",
  r.completed_at::text AS "completedAt", r.updated_at::text AS "updatedAt"`;

export type StartRunInput = {
  orgId: string;
  userId: string;
  sourceKind: "vault" | "url";
  sourceDocumentId: string | null;
  onshapeUrl: string;
  documentId: string;
  workspaceId: string;
  elementId: string;
  assemblyName: string;
};

export async function startRun(client: PoolClient, input: StartRunInput): Promise<{ id: string }> {
  // One in-flight run per assembly. A second one would double the Onshape calls
  // for the same answer, and Onshape's rate limit is shared across the team.
  const inFlight = await client.query<{ id: string }>(
    `SELECT id FROM assembly_manual_runs
      WHERE org_id = $1::uuid AND document_id = $2::text AND element_id = $3::text
        AND status IN ('queued', 'running', 'paused')
      LIMIT 1`,
    [input.orgId, input.documentId, input.elementId],
  );
  if (inFlight.rows[0]) {
    throw new HttpError(
      409,
      "A manual for this assembly is already being built. Open that run instead of starting a second one — they would make the same Onshape calls twice.",
    );
  }

  const inserted = await client.query<{ id: string }>(
    `INSERT INTO assembly_manual_runs
       (org_id, started_by, source_kind, source_document_id, onshape_url,
        document_id, workspace_id, element_id, assembly_name, status, progress)
     VALUES ($1::uuid, $2::uuid, $3::text, $4::uuid, $5::text,
             $6::text, $7::text, $8::text, $9::text, 'queued',
             jsonb_build_object('stage', 'queued', 'stepsDone', 0, 'stepsTotal', 0, 'rendersDone', 0))
     RETURNING id`,
    [
      input.orgId,
      input.userId,
      input.sourceKind,
      input.sourceDocumentId,
      input.onshapeUrl,
      input.documentId,
      input.workspaceId,
      input.elementId,
      input.assemblyName,
    ],
  );
  const row = inserted.rows[0];
  if (!row) throw new HttpError(403, "Only owners and admins can start an assembly manual run");
  return row;
}

export async function listRuns(client: PoolClient, orgId: string, limit = 25): Promise<RunRow[]> {
  const result = await client.query<RunRow>(
    `SELECT ${RUN_COLUMNS}
       FROM assembly_manual_runs r
       LEFT JOIN users u ON u.id = r.started_by
      WHERE r.org_id = $1::uuid
      ORDER BY r.created_at DESC
      LIMIT $2::int`,
    [orgId, Math.min(100, Math.max(1, limit))],
  );
  return result.rows;
}

export async function getRun(client: PoolClient, orgId: string, runId: string): Promise<RunRow | null> {
  const result = await client.query<RunRow>(
    `SELECT ${RUN_COLUMNS}
       FROM assembly_manual_runs r
       LEFT JOIN users u ON u.id = r.started_by
      WHERE r.org_id = $1::uuid AND r.id = $2::uuid`,
    [orgId, runId],
  );
  return result.rows[0] ?? null;
}

export type StepRow = {
  stepNumber: number;
  subassembly: string;
  title: string;
  sentence: string;
  sentenceSource: "model" | "deterministic";
  parts: unknown;
  fabrication: unknown;
  feasibility: unknown;
  disagreement: unknown;
  renderMode: string;
  renderNote: string;
  hasRender: boolean;
};

export async function listSteps(
  client: PoolClient,
  orgId: string,
  runId: string,
  offset = 0,
  limit = 40,
): Promise<StepRow[]> {
  const result = await client.query<StepRow>(
    `SELECT step_number AS "stepNumber", subassembly, title, sentence,
            sentence_source AS "sentenceSource", parts, fabrication, feasibility,
            disagreement, render_mode AS "renderMode", render_note AS "renderNote",
            (render_png IS NOT NULL) AS "hasRender"
       FROM assembly_manual_steps
      WHERE org_id = $1::uuid AND run_id = $2::uuid
      ORDER BY step_number
      OFFSET $3::int LIMIT $4::int`,
    [orgId, runId, Math.max(0, offset), Math.min(200, Math.max(1, limit))],
  );
  return result.rows;
}

export async function countSteps(client: PoolClient, orgId: string, runId: string): Promise<number> {
  const result = await client.query<{ total: number }>(
    `SELECT count(*)::int AS total FROM assembly_manual_steps
      WHERE org_id = $1::uuid AND run_id = $2::uuid`,
    [orgId, runId],
  );
  return result.rows[0]?.total ?? 0;
}

export async function getStepRender(
  client: PoolClient,
  orgId: string,
  runId: string,
  stepNumber: number,
): Promise<Buffer | null> {
  const result = await client.query<{ png: Buffer | null }>(
    `SELECT render_png AS png FROM assembly_manual_steps
      WHERE org_id = $1::uuid AND run_id = $2::uuid AND step_number = $3::int`,
    [orgId, runId, stepNumber],
  );
  return result.rows[0]?.png ?? null;
}

export async function getRunPdf(
  client: PoolClient,
  orgId: string,
  runId: string,
): Promise<{ pdf: Buffer; assemblyName: string } | null> {
  const result = await client.query<{ pdf: Buffer | null; assemblyName: string }>(
    `SELECT pdf, assembly_name AS "assemblyName" FROM assembly_manual_runs
      WHERE org_id = $1::uuid AND id = $2::uuid`,
    [orgId, runId],
  );
  const row = result.rows[0];
  if (!row?.pdf) return null;
  return { pdf: row.pdf, assemblyName: row.assemblyName };
}

/**
 * Ask the worker to stop. Deliberately not a status write: the run may be
 * mid-slice on another machine, and two writers racing on `status` is how a
 * completed run gets marked cancelled. The worker checks this flag between
 * slices and does the transition itself.
 */
export async function requestCancel(client: PoolClient, orgId: string, runId: string): Promise<boolean> {
  const result = await client.query(
    `UPDATE assembly_manual_runs
        SET cancel_requested_at = now(), updated_at = now()
      WHERE org_id = $1::uuid AND id = $2::uuid
        AND status IN ('queued', 'running', 'paused')
        AND cancel_requested_at IS NULL`,
    [orgId, runId],
  );
  return (result.rowCount ?? 0) > 0;
}

/**
 * When a worker last touched any of this org's runs.
 *
 * This is what the UI needs to say "none has checked in since …" honestly. It
 * is derived from real lease activity rather than a separate heartbeat table,
 * so it cannot claim a relay is online when nothing has actually run.
 */
export async function lastWorkerCheckIn(client: PoolClient, orgId: string): Promise<string | null> {
  const result = await client.query<{ at: string | null }>(
    `SELECT max(updated_at)::text AS at
       FROM assembly_manual_runs
      WHERE org_id = $1::uuid AND lease_owner IS NOT NULL`,
    [orgId],
  );
  return result.rows[0]?.at ?? null;
}

/** Vault documents whose external_url points at Onshape — the start form's picker. */
export async function listOnshapeVaultDocuments(
  client: PoolClient,
  orgId: string,
): Promise<Array<{ id: string; title: string; externalUrl: string; seasonYear: number }>> {
  const result = await client.query<{ id: string; title: string; externalUrl: string; seasonYear: number }>(
    `SELECT id, title, external_url AS "externalUrl", season_year AS "seasonYear"
       FROM cad_documents
      WHERE org_id = $1::uuid
        AND status = 'active'
        AND external_url IS NOT NULL
        AND external_url ILIKE '%onshape.com/documents/%'
      ORDER BY season_year DESC, title
      LIMIT 100`,
    [orgId],
  );
  return result.rows;
}
