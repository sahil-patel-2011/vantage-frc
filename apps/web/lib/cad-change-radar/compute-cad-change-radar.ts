import type { PoolClient } from "@neondatabase/serverless";
import { factsBlock, renderFeatureText, renderOutcomeOf, type RenderOutcome } from "../ai-render/render";
import { buildNotificationMessage, classifySeverity, diffParams, summarizeDiffDeterministic } from ".";
import type {
  CadChangeRadarConnection,
  CadChangeRadarDiff,
  CadChangeRadarNotification,
  CadChangeRadarParamDelta,
  CadChangeRadarSeverity,
  CadChangeRadarSnapshot,
  CadChangeRadarSubscription,
} from "./types";

export type CadChangeRadarSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export type CadChangeRadarView =
  | {
      status: "setup_required";
      message: string;
      steps: CadChangeRadarSetupStep[];
      orgId: string | null;
    }
  | {
      status: "live";
      orgId: string;
      teamNumber: number | null;
      connection: CadChangeRadarConnection;
      snapshots: CadChangeRadarSnapshot[];
      diffs: CadChangeRadarDiff[];
      subscriptions: CadChangeRadarSubscription[];
      mySubscriptions: CadChangeRadarSubscription[];
      notifications: CadChangeRadarNotification[];
      computedAt: string;
    };

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

type ConnectionRow = { id: string; label: string; status: string };

type SnapshotRow = {
  id: string;
  partKey: string;
  partName: string;
  revision: string;
  params: Record<string, number | string> | null;
  massKg: string | null;
  capturedAt: string;
};

type DiffRow = {
  id: string;
  partKey: string;
  partName: string;
  fromRevision: string | null;
  toRevision: string;
  changedParams: CadChangeRadarParamDelta[] | null;
  severity: CadChangeRadarSeverity;
  aiSummary: string | null;
  createdAt: string;
};

type SubscriptionRow = {
  id: string;
  userId: string;
  userName: string | null;
  partKey: string;
  subsystem: string | null;
  createdAt: string;
};

type NotificationRow = {
  id: string;
  diffId: string;
  partKey: string;
  partName: string;
  message: string;
  severity: CadChangeRadarSeverity;
  acknowledgedAt: string | null;
  createdAt: string;
};

function mapSnapshot(row: SnapshotRow): CadChangeRadarSnapshot {
  return {
    id: row.id,
    partKey: row.partKey,
    partName: row.partName,
    revision: row.revision,
    params: row.params ?? {},
    massKg: row.massKg == null ? null : Number(row.massKg),
    capturedAt: row.capturedAt,
  };
}

function mapDiff(row: DiffRow): CadChangeRadarDiff {
  return {
    id: row.id,
    partKey: row.partKey,
    partName: row.partName,
    fromRevision: row.fromRevision,
    toRevision: row.toRevision,
    changedParams: Array.isArray(row.changedParams) ? row.changedParams : [],
    severity: row.severity,
    aiSummary: row.aiSummary,
    createdAt: row.createdAt,
  };
}

function mapSubscription(row: SubscriptionRow): CadChangeRadarSubscription {
  return {
    id: row.id,
    userId: row.userId,
    userName: row.userName,
    partKey: row.partKey,
    subsystem: row.subsystem,
    createdAt: row.createdAt,
  };
}

function mapNotification(row: NotificationRow): CadChangeRadarNotification {
  return {
    id: row.id,
    diffId: row.diffId,
    partKey: row.partKey,
    partName: row.partName,
    message: row.message,
    severity: row.severity,
    acknowledgedAt: row.acknowledgedAt,
    createdAt: row.createdAt,
  };
}

export async function computeCadChangeRadarView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null },
): Promise<CadChangeRadarView> {
  const org = await resolveOrg(client, input.userId, input.requestedOrg);

  if (!org) {
    return {
      status: "setup_required",
      message: "Select a team workspace to track CAD release changes.",
      steps: [
        { id: "workspace", label: "Select workspace", detail: "Choose your team organization", href: "/workspace" },
      ],
      orgId: null,
    };
  }

  const connectionResult = await client.query<ConnectionRow>(
    // The caller's own connection first, then the org's shared team row (user_id IS NULL, 0493).
    `SELECT id, label, status FROM cad_connections
     WHERE org_id = $1::uuid AND (user_id = $2::uuid OR user_id IS NULL) AND platform = 'onshape'
       AND status = 'connected' AND disabled_at IS NULL
     ORDER BY (user_id IS NULL) ASC, updated_at DESC LIMIT 1`,
    [org.orgId, input.userId],
  );
  const connectionRow = connectionResult.rows[0] ?? null;

  if (!connectionRow) {
    return {
      status: "setup_required",
      message: "Connect an Onshape workspace to start tracking CAD release changes.",
      steps: [
        {
          id: "cad",
          label: "Connect Onshape",
          detail: "The radar snapshots tracked parameters from your Onshape releases — connect a workspace first.",
          href: "/build?tab=cad",
        },
      ],
      orgId: org.orgId,
    };
  }

  const [snapshotResult, diffResult, subscriptionResult, notificationResult] = await Promise.all([
    client.query<SnapshotRow>(
      `SELECT DISTINCT ON (part_key) id, part_key AS "partKey", part_name AS "partName", revision,
              params, mass_kg AS "massKg", captured_at AS "capturedAt"
       FROM cad_change_radar_snapshots
       WHERE org_id = $1
       ORDER BY part_key, captured_at DESC`,
      [org.orgId],
    ),
    client.query<DiffRow>(
      `SELECT id, part_key AS "partKey", part_name AS "partName", from_revision AS "fromRevision",
              to_revision AS "toRevision", changed_params AS "changedParams", severity,
              ai_summary AS "aiSummary", created_at AS "createdAt"
       FROM cad_change_radar_diffs
       WHERE org_id = $1
       ORDER BY created_at DESC
       LIMIT 50`,
      [org.orgId],
    ),
    client.query<SubscriptionRow>(
      `SELECT s.id, s.user_id AS "userId", u.name AS "userName", s.part_key AS "partKey",
              s.subsystem, s.created_at AS "createdAt"
       FROM cad_change_radar_subscriptions s
       JOIN users u ON u.id = s.user_id
       WHERE s.org_id = $1
       ORDER BY s.created_at DESC`,
      [org.orgId],
    ),
    client.query<NotificationRow>(
      `SELECT n.id, n.diff_id AS "diffId", d.part_key AS "partKey", d.part_name AS "partName",
              n.message, d.severity, n.acknowledged_at AS "acknowledgedAt", n.created_at AS "createdAt"
       FROM cad_change_radar_notifications n
       JOIN cad_change_radar_diffs d ON d.id = n.diff_id
       WHERE n.org_id = $1 AND n.user_id = $2
       ORDER BY n.created_at DESC
       LIMIT 50`,
      [org.orgId, input.userId],
    ),
  ]);

  const subscriptions = subscriptionResult.rows.map(mapSubscription);

  return {
    status: "live",
    orgId: org.orgId,
    teamNumber: org.teamNumber,
    connection: { id: connectionRow.id, label: connectionRow.label, status: connectionRow.status },
    snapshots: snapshotResult.rows.map(mapSnapshot),
    diffs: diffResult.rows.map(mapDiff),
    subscriptions,
    mySubscriptions: subscriptions.filter((s) => s.userId === input.userId),
    notifications: notificationResult.rows.map(mapNotification),
    computedAt: new Date().toISOString(),
  };
}

// ---- write helpers (run inside the caller's withRls transaction) ----

/**
 * Records a new revision snapshot for a part, diffs it against the most recent prior snapshot of
 * the same part-key, and fans out notifications to every member subscribed to that part-key.
 */
export async function recordSnapshot(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    connectionId: string;
    partKey: string;
    partName: string;
    revision: string;
    params: Record<string, number | string>;
    massKg: number | null;
  },
): Promise<{ diffId: string | null }> {
  const priorResult = await client.query<SnapshotRow>(
    `SELECT id, part_key AS "partKey", part_name AS "partName", revision, params,
            mass_kg AS "massKg", captured_at AS "capturedAt"
     FROM cad_change_radar_snapshots
     WHERE org_id = $1 AND part_key = $2
     ORDER BY captured_at DESC LIMIT 1`,
    [input.orgId, input.partKey],
  );
  const prior = priorResult.rows[0] ?? null;

  const params: Record<string, number | string> = { ...input.params };
  if (input.massKg != null) params.mass_kg = input.massKg;

  const snapshotResult = await client.query<{ id: string }>(
    `INSERT INTO cad_change_radar_snapshots (
       org_id, connection_id, part_key, part_name, revision, params, mass_kg, created_by
     ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8)
     ON CONFLICT (org_id, part_key, revision) DO UPDATE SET params = EXCLUDED.params, mass_kg = EXCLUDED.mass_kg
     RETURNING id`,
    [
      input.orgId,
      input.connectionId,
      input.partKey,
      input.partName,
      input.revision,
      JSON.stringify(params),
      input.massKg,
      input.userId,
    ],
  );
  const snapshotId = snapshotResult.rows[0]!.id;

  if (!prior || prior.revision === input.revision) return { diffId: null };

  const deltas = diffParams(prior.params, params);
  if (deltas.length === 0) return { diffId: null };
  const severity = classifySeverity(deltas);
  const summary = summarizeDiffDeterministic({ partName: input.partName, toRevision: input.revision, deltas });

  const diffResult = await client.query<{ id: string }>(
    `INSERT INTO cad_change_radar_diffs (
       org_id, part_key, part_name, from_snapshot_id, to_snapshot_id, from_revision, to_revision,
       changed_params, severity, ai_summary, created_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11)
     RETURNING id`,
    [
      input.orgId,
      input.partKey,
      input.partName,
      prior.id,
      snapshotId,
      prior.revision,
      input.revision,
      JSON.stringify(deltas),
      severity,
      summary,
      input.userId,
    ],
  );
  const diffId = diffResult.rows[0]!.id;

  const subscribers = await client.query<{ userId: string }>(
    `SELECT DISTINCT user_id AS "userId" FROM cad_change_radar_subscriptions
     WHERE org_id = $1 AND part_key = $2`,
    [input.orgId, input.partKey],
  );
  const message = buildNotificationMessage({
    partName: input.partName,
    toRevision: input.revision,
    severity,
    summary,
  });
  for (const subscriber of subscribers.rows) {
    await client.query(
      `INSERT INTO cad_change_radar_notifications (org_id, diff_id, user_id, message)
       VALUES ($1,$2,$3,$4)`,
      [input.orgId, diffId, subscriber.userId, message],
    );
  }

  return { diffId };
}

/** Optional metered-AI plain-language diff summary — replaces the deterministic fallback on the diff row. */
export async function generateAiDiffSummary(
  client: PoolClient,
  input: { orgId: string; userId: string; diffId: string },
): Promise<{ summary: string; render: RenderOutcome }> {
  const diffResult = await client.query<DiffRow>(
    `SELECT id, part_key AS "partKey", part_name AS "partName", from_revision AS "fromRevision",
            to_revision AS "toRevision", changed_params AS "changedParams", severity,
            ai_summary AS "aiSummary", created_at AS "createdAt"
     FROM cad_change_radar_diffs WHERE id = $1 AND org_id = $2`,
    [input.diffId, input.orgId],
  );
  const diff = diffResult.rows[0];
  if (!diff) throw new Error("Diff not found");
  const deltas = Array.isArray(diff.changedParams) ? diff.changedParams : [];

  // Real model call on the org's adapter; the deterministic diff summary stands in on any failure.
  const rendered = await renderFeatureText({
    client,
    orgId: input.orgId,
    userId: input.userId,
    feature: "cad_change_radar",
    prompt: [
      `Summarize this CAD revision for the design team in 1-2 plain sentences, keeping the template's structure: "<part> revision <rev>: <each changed parameter with its exact from → to values>".`,
      "Use only these facts; invent nothing and drop no parameter:",
      factsBlock({ partName: diff.partName, partKey: diff.partKey, toRevision: diff.toRevision, deltas: deltas.slice(0, 12) }),
    ].join("\n"),
    template: () => summarizeDiffDeterministic({ partName: diff.partName, toRevision: diff.toRevision, deltas }),
    metadata: { partKey: diff.partKey, toRevision: diff.toRevision, deltaCount: deltas.length },
  });
  const summary = rendered.text;

  await client.query(`UPDATE cad_change_radar_diffs SET ai_summary = $1 WHERE id = $2 AND org_id = $3`, [
    summary,
    input.diffId,
    input.orgId,
  ]);
  return { summary, render: renderOutcomeOf(rendered) };
}

export async function subscribe(
  client: PoolClient,
  input: { orgId: string; userId: string; partKey: string; subsystem: string | null },
): Promise<void> {
  await client.query(
    `INSERT INTO cad_change_radar_subscriptions (org_id, user_id, part_key, subsystem)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (org_id, user_id, part_key) DO UPDATE SET subsystem = EXCLUDED.subsystem`,
    [input.orgId, input.userId, input.partKey, input.subsystem],
  );
}

export async function unsubscribe(
  client: PoolClient,
  input: { orgId: string; userId: string; subscriptionId: string },
): Promise<void> {
  await client.query(
    `DELETE FROM cad_change_radar_subscriptions WHERE id = $1 AND org_id = $2 AND user_id = $3`,
    [input.subscriptionId, input.orgId, input.userId],
  );
}

export async function acknowledgeNotification(
  client: PoolClient,
  input: { orgId: string; userId: string; notificationId: string },
): Promise<void> {
  await client.query(
    `UPDATE cad_change_radar_notifications SET acknowledged_at = now()
     WHERE id = $1 AND org_id = $2 AND user_id = $3`,
    [input.notificationId, input.orgId, input.userId],
  );
}
