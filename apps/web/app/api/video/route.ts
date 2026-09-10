import type { PoolClient } from "@neondatabase/serverless";
import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  parseVideoAction,
  sortNotes,
  type VideoNote,
  type VideoReview,
  type VideoView,
} from "../../../lib/video-review";

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function requireSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new HttpError(401, "Authentication required");
  return session;
}

async function requireMembership(client: PoolClient, orgId: string, userId: string) {
  const row = await client.query(`SELECT 1 FROM memberships WHERE org_id = $1 AND user_id = $2 LIMIT 1`, [orgId, userId]);
  if (!row.rowCount) throw new HttpError(403, "Organization membership required");
}

async function bumpReview(client: PoolClient, reviewId: string, orgId: string) {
  const updated = await client.query(`UPDATE video_reviews SET updated_at = now() WHERE id = $1 AND org_id = $2`, [
    reviewId,
    orgId,
  ]);
  if (!updated.rowCount) throw new HttpError(404, "Review not found");
}

function fail(error: unknown) {
  const status = error instanceof HttpError ? error.status : 400;
  return Response.json({ error: error instanceof Error ? error.message : "Video request failed" }, { status });
}

export async function GET(request: Request) {
  try {
    const session = await requireSession();
    const url = new URL(request.url);
    const requestedOrg = url.searchParams.get("orgId");

    const view = await withRls({ userId: session.user.id }, async (client) => {
      const membership = await client.query<{
        orgId: string;
        orgName: string;
        teamNumber: number | null;
        role: string;
      }>(
        `SELECT m.org_id AS "orgId", o.name AS "orgName", o.team_number AS "teamNumber", m.role
         FROM memberships m
         JOIN organizations o ON o.id = m.org_id
         WHERE m.user_id = $1 AND ($2::uuid IS NULL OR m.org_id = $2::uuid)
         ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, o.team_number
         LIMIT 1`,
        [session.user.id, requestedOrg],
      );

      const row = membership.rows[0];
      if (!row) {
        return {
          status: "setup_required",
          message: "Select a team to review match video.",
          context: { orgId: null, orgName: null, teamNumber: null, role: null },
        } satisfies VideoView;
      }

      const [reviews, notes] = await Promise.all([
        client.query<Omit<VideoReview, "notes">>(
          `SELECT r.id, r.title, r.url, r.video_id AS "videoId", r.match_key AS "matchKey", r.team_key AS "teamKey",
                  r.notes AS "summary", u.name AS "createdByName", r.updated_at::text AS "updatedAt"
           FROM video_reviews r
           LEFT JOIN users u ON u.id = r.created_by
           WHERE r.org_id = $1
           ORDER BY r.updated_at DESC
           LIMIT 100`,
          [row.orgId],
        ),
        client.query<VideoNote>(
          `SELECT n.id, n.review_id AS "reviewId", n.at_seconds AS "atSeconds", n.tag, n.body,
                  u.name AS "createdByName", n.created_at::text AS "createdAt"
           FROM video_notes n
           LEFT JOIN users u ON u.id = n.created_by
           WHERE n.org_id = $1
           ORDER BY n.review_id, n.at_seconds`,
          [row.orgId],
        ),
      ]);

      const byReview = new Map<string, VideoNote[]>();
      for (const entry of notes.rows) {
        const list = byReview.get(entry.reviewId) ?? [];
        list.push(entry);
        byReview.set(entry.reviewId, list);
      }

      return {
        status: "ready",
        context: {
          orgId: row.orgId,
          orgName: row.orgName,
          teamNumber: row.teamNumber,
          role: row.role,
        },
        reviews: reviews.rows.map((review) => ({ ...review, notes: sortNotes(byReview.get(review.id) ?? []) })),
      } satisfies VideoView;
    });

    return Response.json(view);
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireSession();
    const action = parseVideoAction(await request.json());
    const userId = session.user.id;

    const result = await withRls({ userId, orgId: action.orgId }, async (client) => {
      await requireMembership(client, action.orgId, userId);

      switch (action.action) {
        case "create_review": {
          const inserted = await client.query<{ id: string }>(
            `INSERT INTO video_reviews (org_id, title, url, video_id, match_key, team_key, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
            [action.orgId, action.title, action.url, action.videoId, action.matchKey, action.teamKey, userId],
          );
          return { id: inserted.rows[0]!.id };
        }

        case "update_review": {
          const sets: string[] = [];
          const values: unknown[] = [action.id, action.orgId];
          if (action.patch.title !== undefined) {
            values.push(action.patch.title);
            sets.push(`title = $${values.length}`);
          }
          if (action.patch.matchKey !== undefined) {
            values.push(action.patch.matchKey);
            sets.push(`match_key = $${values.length}`);
          }
          if (action.patch.teamKey !== undefined) {
            values.push(action.patch.teamKey);
            sets.push(`team_key = $${values.length}`);
          }
          if (action.patch.summary !== undefined) {
            values.push(action.patch.summary);
            sets.push(`notes = $${values.length}`);
          }
          const updated = await client.query(
            `UPDATE video_reviews SET ${sets.join(", ")}, updated_at = now() WHERE id = $1 AND org_id = $2`,
            values,
          );
          if (!updated.rowCount) throw new HttpError(404, "Review not found");
          return { ok: true };
        }

        case "delete_review": {
          const deleted = await client.query(`DELETE FROM video_reviews WHERE id = $1 AND org_id = $2`, [
            action.id,
            action.orgId,
          ]);
          if (!deleted.rowCount) throw new HttpError(403, "You cannot delete this review");
          return { ok: true };
        }

        case "add_note": {
          const inserted = await client.query<{ id: string }>(
            `INSERT INTO video_notes (org_id, review_id, at_seconds, tag, body, created_by)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
            [action.orgId, action.reviewId, action.atSeconds, action.tag, action.body, userId],
          );
          await bumpReview(client, action.reviewId, action.orgId);
          return { id: inserted.rows[0]!.id };
        }

        case "update_note": {
          const sets: string[] = [];
          const values: unknown[] = [action.id, action.orgId];
          if (action.patch.atSeconds !== undefined) {
            values.push(action.patch.atSeconds);
            sets.push(`at_seconds = $${values.length}`);
          }
          if (action.patch.tag !== undefined) {
            values.push(action.patch.tag);
            sets.push(`tag = $${values.length}`);
          }
          if (action.patch.body !== undefined) {
            values.push(action.patch.body);
            sets.push(`body = $${values.length}`);
          }
          const updated = await client.query<{ reviewId: string }>(
            `UPDATE video_notes SET ${sets.join(", ")} WHERE id = $1 AND org_id = $2 RETURNING review_id AS "reviewId"`,
            values,
          );
          if (!updated.rowCount) throw new HttpError(404, "Note not found");
          await bumpReview(client, updated.rows[0]!.reviewId, action.orgId);
          return { ok: true };
        }

        case "delete_note": {
          const deleted = await client.query<{ reviewId: string }>(
            `DELETE FROM video_notes WHERE id = $1 AND org_id = $2 RETURNING review_id AS "reviewId"`,
            [action.id, action.orgId],
          );
          if (!deleted.rowCount) throw new HttpError(404, "Note not found");
          await bumpReview(client, deleted.rows[0]!.reviewId, action.orgId);
          return { ok: true };
        }

        default:
          throw new HttpError(400, "Unsupported video action");
      }
    });

    return Response.json(result);
  } catch (error) {
    return fail(error);
  }
}
