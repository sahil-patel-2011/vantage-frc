/**
 * Team announcements.
 *
 * `team_announcements` has existed since 0136 with a `require_ack` flag and no
 * way for anyone to acknowledge anything, no API and no page. Its only writer
 * was the automatic match alert. This is the rest of the feature.
 *
 * All access is through the `withRls` PoolClient; nothing here imports
 * @vantage/db/admin.
 */

import type { PoolClient } from "@neondatabase/serverless";

export const ANNOUNCEMENT_PRIORITIES = ["normal", "important", "urgent"] as const;
export type AnnouncementPriority = (typeof ANNOUNCEMENT_PRIORITIES)[number];

export function isAnnouncementPriority(value: unknown): value is AnnouncementPriority {
  return typeof value === "string" && (ANNOUNCEMENT_PRIORITIES as readonly string[]).includes(value);
}

export type Announcement = {
  id: string;
  title: string;
  body: string;
  priority: AnnouncementPriority;
  pinned: boolean;
  requireAck: boolean;
  authorName: string | null;
  createdAt: string;
  /** How many members have acknowledged. Only meaningful when requireAck. */
  ackCount: number;
  /** Members eligible to acknowledge, so "12 of 30" is answerable. */
  memberCount: number;
  /** Whether the caller has acknowledged it. */
  acknowledged: boolean;
};

export async function listAnnouncements(
  client: PoolClient,
  orgId: string,
  userId: string,
): Promise<Announcement[]> {
  const result = await client.query<Announcement>(
    `SELECT a.id,
            a.title,
            a.body,
            a.priority,
            a.pinned,
            a.require_ack AS "requireAck",
            u.name AS "authorName",
            a.created_at::text AS "createdAt",
            (SELECT count(*)::int FROM announcement_acks k WHERE k.announcement_id = a.id) AS "ackCount",
            (SELECT count(*)::int FROM memberships m WHERE m.org_id = a.org_id) AS "memberCount",
            EXISTS (
              SELECT 1 FROM announcement_acks k
               WHERE k.announcement_id = a.id AND k.user_id = $2::uuid
            ) AS acknowledged
       FROM team_announcements a
       LEFT JOIN users u ON u.id = a.created_by
      WHERE a.org_id = $1::uuid
      -- Pinned first, then newest. An urgent-but-old notice that leadership
      -- pinned outranks a normal one from this morning, which is the whole
      -- reason the pin exists.
      ORDER BY a.pinned DESC, a.created_at DESC
      LIMIT 100`,
    [orgId, userId],
  );
  return result.rows;
}

export async function createAnnouncement(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    title: string;
    body: string;
    priority: AnnouncementPriority;
    pinned: boolean;
    requireAck: boolean;
  },
): Promise<string> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO team_announcements (org_id, title, body, priority, pinned, require_ack, created_by)
     VALUES ($1::uuid, $2, $3, $4, $5, $6, $7::uuid)
     RETURNING id`,
    [input.orgId, input.title, input.body, input.priority, input.pinned, input.requireAck, input.userId],
  );
  const row = result.rows[0];
  if (!row) throw new Error("Could not post the announcement");
  return row.id;
}

/**
 * One inbox row per member, excluding the author.
 *
 * A single INSERT…SELECT over memberships rather than a loop, so a 60-person
 * team is one statement. The peer-insert policy (0602) constrains every row to
 * a member of the poster's own org.
 */
export async function fanOutAnnouncement(
  client: PoolClient,
  input: { orgId: string; announcementId: string; authorId: string; title: string; priority: string },
): Promise<number> {
  const result = await client.query(
    `INSERT INTO notifications (user_id, org_id, type, payload)
     SELECT m.user_id, $1::uuid, 'team_announcement',
            jsonb_build_object(
              'announcementId', $2::uuid,
              'title', $3::text,
              'priority', $4::text,
              'href', '/announcements'
            )
       FROM memberships m
      WHERE m.org_id = $1::uuid
        AND m.user_id <> $5::uuid`,
    [input.orgId, input.announcementId, input.title, input.priority, input.authorId],
  );
  return result.rowCount ?? 0;
}

export async function acknowledge(
  client: PoolClient,
  input: { orgId: string; announcementId: string; userId: string },
): Promise<void> {
  await client.query(
    `INSERT INTO announcement_acks (org_id, announcement_id, user_id)
     VALUES ($1::uuid, $2::uuid, $3::uuid)
     ON CONFLICT (announcement_id, user_id) DO NOTHING`,
    [input.orgId, input.announcementId, input.userId],
  );
}

export async function setPinned(
  client: PoolClient,
  orgId: string,
  announcementId: string,
  pinned: boolean,
): Promise<void> {
  await client.query(
    `UPDATE team_announcements SET pinned = $3 WHERE id = $2::uuid AND org_id = $1::uuid`,
    [orgId, announcementId, pinned],
  );
}

export async function deleteAnnouncement(
  client: PoolClient,
  orgId: string,
  announcementId: string,
): Promise<void> {
  await client.query(`DELETE FROM team_announcements WHERE id = $2::uuid AND org_id = $1::uuid`, [
    orgId,
    announcementId,
  ]);
}

/** Members who have not acknowledged yet — the list a lead actually chases. */
export async function outstandingAcks(
  client: PoolClient,
  orgId: string,
  announcementId: string,
): Promise<string[]> {
  const result = await client.query<{ name: string }>(
    `SELECT COALESCE(u.name, u.email) AS name
       FROM memberships m
       JOIN users u ON u.id = m.user_id
      WHERE m.org_id = $1::uuid
        AND NOT EXISTS (
          SELECT 1 FROM announcement_acks k
           WHERE k.announcement_id = $2::uuid AND k.user_id = m.user_id
        )
      ORDER BY name`,
    [orgId, announcementId],
  );
  return result.rows.map((row) => row.name);
}
