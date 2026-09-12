import type { PoolClient } from "@neondatabase/serverless";
import { summarizeObjectChatBridge } from ".";
import type {
  ObjectChatBridgeLink,
  ObjectChatBridgeLinkStatus,
  ObjectChatBridgeNotification,
  ObjectChatBridgeObjectType,
  ObjectChatBridgeSubteam,
  ObjectChatBridgeSummary,
} from "./types";

export function currentSeasonYear(now: Date = new Date()): number {
  return now.getUTCFullYear();
}

export type ObjectChatBridgeSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export type ObjectChatBridgeView =
  | {
      status: "setup_required";
      message: string;
      steps: ObjectChatBridgeSetupStep[];
      orgId: string | null;
      seasonYear: number;
    }
  | {
      status: "live";
      orgId: string;
      teamNumber: number | null;
      seasonYear: number;
      seasons: number[];
      links: ObjectChatBridgeLink[];
      summary: ObjectChatBridgeSummary;
      computedAt: string;
    };

type LinkRow = {
  id: string;
  objectType: ObjectChatBridgeObjectType;
  objectRef: string;
  objectLabel: string | null;
  threadRef: string;
  subteam: ObjectChatBridgeSubteam;
  status: ObjectChatBridgeLinkStatus;
  context: string | null;
  seasonYear: number;
  createdAt: string;
};

type NotificationRow = {
  id: string;
  linkId: string;
  notifiedSubteam: ObjectChatBridgeSubteam;
  message: string;
  acknowledged: boolean;
  acknowledgedAt: string | null;
  createdAt: string;
};

function mapNotification(row: NotificationRow): ObjectChatBridgeNotification {
  return {
    id: row.id,
    linkId: row.linkId,
    notifiedSubteam: row.notifiedSubteam,
    message: row.message,
    acknowledged: row.acknowledged,
    acknowledgedAt: row.acknowledgedAt,
    createdAt: row.createdAt,
  };
}

function mapLink(row: LinkRow, notifications: ObjectChatBridgeNotification[]): ObjectChatBridgeLink {
  return {
    id: row.id,
    objectType: row.objectType,
    objectRef: row.objectRef,
    objectLabel: row.objectLabel,
    threadRef: row.threadRef,
    subteam: row.subteam,
    status: row.status,
    context: row.context,
    seasonYear: row.seasonYear,
    createdAt: row.createdAt,
    notifications,
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

export async function computeObjectChatBridgeView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null; seasonYear?: number | null },
): Promise<ObjectChatBridgeView> {
  const org = await resolveOrg(client, input.userId, input.requestedOrg);
  const seasonYear = input.seasonYear && input.seasonYear > 2000 ? input.seasonYear : currentSeasonYear();

  if (!org) {
    return {
      status: "setup_required",
      message: "Choose your team to link chat threads to subsystems, orders, and incidents.",
      steps: [
        { id: "workspace", label: "Choose your team", detail: "Choose which FRC team you are working as.", href: "/workspace" },
      ],
      orgId: null,
      seasonYear,
    };
  }

  const [linkResult, notificationResult, seasonResult] = await Promise.all([
    client.query<LinkRow>(
      `SELECT id, object_type AS "objectType", object_ref AS "objectRef", object_label AS "objectLabel",
              thread_ref AS "threadRef", subteam, status, context, season_year AS "seasonYear",
              created_at::text AS "createdAt"
       FROM object_chat_bridge_links
       WHERE org_id = $1 AND season_year = $2
       ORDER BY created_at DESC`,
      [org.orgId, seasonYear],
    ),
    client.query<NotificationRow>(
      `SELECT n.id, n.link_id AS "linkId", n.notified_subteam AS "notifiedSubteam", n.message,
              n.acknowledged, n.acknowledged_at::text AS "acknowledgedAt", n.created_at::text AS "createdAt"
       FROM object_chat_bridge_notifications n
       JOIN object_chat_bridge_links l ON l.id = n.link_id
       WHERE n.org_id = $1 AND l.season_year = $2
       ORDER BY n.created_at DESC`,
      [org.orgId, seasonYear],
    ),
    client.query<{ seasonYear: number }>(
      `SELECT DISTINCT season_year AS "seasonYear" FROM object_chat_bridge_links WHERE org_id = $1 ORDER BY season_year DESC`,
      [org.orgId],
    ),
  ]);

  const notificationsByLink = new Map<string, ObjectChatBridgeNotification[]>();
  for (const row of notificationResult.rows) {
    const notification = mapNotification(row);
    const bucket = notificationsByLink.get(notification.linkId);
    if (bucket) bucket.push(notification);
    else notificationsByLink.set(notification.linkId, [notification]);
  }

  const links = linkResult.rows.map((row) => mapLink(row, notificationsByLink.get(row.id) ?? []));
  const summary = summarizeObjectChatBridge(links);

  const seasons = seasonResult.rows.map((r) => r.seasonYear);
  if (!seasons.includes(seasonYear)) seasons.unshift(seasonYear);

  return {
    status: "live",
    orgId: org.orgId,
    teamNumber: org.teamNumber,
    seasonYear,
    seasons,
    links,
    summary,
    computedAt: new Date().toISOString(),
  };
}

// ---- write helpers (run inside the caller's withRls transaction) ----

export async function createLink(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    objectType: ObjectChatBridgeObjectType;
    objectRef: string;
    objectLabel: string | null;
    threadRef: string;
    subteam: ObjectChatBridgeSubteam;
    context: string | null;
    seasonYear: number;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO object_chat_bridge_links (
       org_id, object_type, object_ref, object_label, thread_ref, subteam, context, season_year, created_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      input.orgId,
      input.objectType,
      input.objectRef,
      input.objectLabel,
      input.threadRef,
      input.subteam,
      input.context,
      input.seasonYear,
      input.userId,
    ],
  );
}

export async function updateLinkStatus(
  client: PoolClient,
  input: { orgId: string; linkId: string; status: ObjectChatBridgeLinkStatus },
): Promise<void> {
  await client.query(`UPDATE object_chat_bridge_links SET status = $1 WHERE id = $2 AND org_id = $3`, [
    input.status,
    input.linkId,
    input.orgId,
  ]);
}

export async function deleteLink(client: PoolClient, input: { orgId: string; linkId: string }): Promise<void> {
  await client.query(`DELETE FROM object_chat_bridge_links WHERE id = $1 AND org_id = $2`, [
    input.linkId,
    input.orgId,
  ]);
}

export async function notifySubteam(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    linkId: string;
    notifiedSubteam: ObjectChatBridgeSubteam;
    message: string;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO object_chat_bridge_notifications (org_id, link_id, notified_subteam, message, created_by)
     VALUES ($1,$2,$3,$4,$5)`,
    [input.orgId, input.linkId, input.notifiedSubteam, input.message, input.userId],
  );
}

export async function acknowledgeNotification(
  client: PoolClient,
  input: { orgId: string; userId: string; notificationId: string },
): Promise<void> {
  await client.query(
    `UPDATE object_chat_bridge_notifications
     SET acknowledged = true, acknowledged_by = $1, acknowledged_at = now()
     WHERE id = $2 AND org_id = $3`,
    [input.userId, input.notificationId, input.orgId],
  );
}
