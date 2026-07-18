import type { PoolClient } from "@neondatabase/serverless";
import { loadDataSourceHealth, type DataSourceHealthView } from "../reference-health";
import { computeDegradedFallbacks, shouldShowDegradedBanner } from ".";
import type { DegradedModeAcknowledgment, DegradedModeFallback, DegradedModeReason, DegradedModeSource } from "./types";

export type DegradedModeSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export type DegradedModeView =
  | {
      status: "setup_required";
      message: string;
      steps: DegradedModeSetupStep[];
      orgId: string | null;
    }
  | {
      status: "live";
      orgId: string;
      teamNumber: number | null;
      health: DataSourceHealthView;
      showBanner: boolean;
      fallbacks: DegradedModeFallback[];
      activeAcknowledgment: DegradedModeAcknowledgment | null;
      recentAcknowledgments: DegradedModeAcknowledgment[];
      computedAt: string;
    };

type AckRow = {
  id: string;
  source: DegradedModeSource;
  mode: DegradedModeReason;
  note: string | null;
  acknowledgedBy: string;
  acknowledgedAt: string;
  resolvedAt: string | null;
};

function mapAck(row: AckRow): DegradedModeAcknowledgment {
  return {
    id: row.id,
    source: row.source,
    mode: row.mode,
    note: row.note,
    acknowledgedBy: row.acknowledgedBy,
    acknowledgedAt: row.acknowledgedAt,
    resolvedAt: row.resolvedAt,
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

export async function computeDegradedModeView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null },
): Promise<DegradedModeView> {
  const org = await resolveOrg(client, input.userId, input.requestedOrg);

  if (!org) {
    return {
      status: "setup_required",
      message: "Select a team workspace to see data-source health and degraded-mode fallbacks.",
      steps: [
        { id: "workspace", label: "Select workspace", detail: "Choose your team organization", href: "/workspace" },
      ],
      orgId: null,
    };
  }

  const [health, ackResult] = await Promise.all([
    loadDataSourceHealth(client, org.orgId),
    client.query<AckRow>(
      `SELECT id, source, mode, note, acknowledged_by AS "acknowledgedBy",
              acknowledged_at::text AS "acknowledgedAt", resolved_at::text AS "resolvedAt"
       FROM degraded_mode_acknowledgments
       WHERE org_id = $1
       ORDER BY acknowledged_at DESC
       LIMIT 20`,
      [org.orgId],
    ),
  ]);

  const recentAcknowledgments = ackResult.rows.map(mapAck);
  const activeAcknowledgment =
    recentAcknowledgments.find((ack) => !ack.resolvedAt && ack.mode === health.mode) ?? null;

  return {
    status: "live",
    orgId: org.orgId,
    teamNumber: org.teamNumber,
    health,
    showBanner: shouldShowDegradedBanner(health.mode),
    fallbacks: computeDegradedFallbacks(health.mode, org.orgId),
    activeAcknowledgment,
    recentAcknowledgments,
    computedAt: new Date().toISOString(),
  };
}

// ---- write helpers (run inside the caller's withRls transaction) ----

export async function acknowledgeDegradedMode(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    source: DegradedModeSource;
    mode: DegradedModeReason;
    note: string | null;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO degraded_mode_acknowledgments (org_id, source, mode, note, acknowledged_by)
     VALUES ($1,$2,$3,$4,$5)`,
    [input.orgId, input.source, input.mode, input.note, input.userId],
  );
}

export async function clearAcknowledgment(
  client: PoolClient,
  input: { orgId: string; acknowledgmentId: string },
): Promise<void> {
  await client.query(
    `UPDATE degraded_mode_acknowledgments SET resolved_at = now()
     WHERE id = $1 AND org_id = $2 AND resolved_at IS NULL`,
    [input.acknowledgmentId, input.orgId],
  );
}
