import type { PoolClient } from "@neondatabase/serverless";
import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { ScoutingRepository } from "@vantage/scouting/repository";
import type { SchemaDefinition } from "@vantage/scouting";
import { headers } from "next/headers";
import {
  buildVideoRescoutSyncEntries,
  parseVideoRescoutAction,
  sortTimelineScores,
  type RescoutReview,
  type RescoutView,
  type TimelineScore,
} from "../../../../lib/video-rescout";
import { sortNotes, type VideoNote } from "../../../../lib/video-review";

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function isMissingSchema(error: unknown): boolean {
  return error instanceof Error && /(relation|column) .* does not exist/i.test(error.message);
}

async function requireSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new HttpError(401, "Authentication required");
  return session;
}

async function requireMembership(client: PoolClient, orgId: string, userId: string) {
  const row = await client.query(`SELECT 1 FROM memberships WHERE org_id = $1 AND user_id = $2 LIMIT 1`, [
    orgId,
    userId,
  ]);
  if (!row.rowCount) throw new HttpError(403, "Organization membership required");
}

function fail(error: unknown) {
  const status = error instanceof HttpError ? error.status : 400;
  return Response.json({ error: error instanceof Error ? error.message : "Video re-scout request failed" }, { status });
}

async function loadReview(client: PoolClient, orgId: string, reviewId: string) {
  try {
    const review = await client.query<{
      id: string;
      matchKey: string | null;
      assignedTeamKeys: string[];
    }>(
      `SELECT id, match_key AS "matchKey", assigned_team_keys AS "assignedTeamKeys"
       FROM video_reviews WHERE id = $1 AND org_id = $2`,
      [reviewId, orgId],
    );
    const row = review.rows[0];
    if (!row) throw new HttpError(404, "Review not found");
    return row;
  } catch (error) {
    if (!isMissingSchema(error)) throw error;
    const review = await client.query<{ id: string; matchKey: string | null }>(
      `SELECT id, match_key AS "matchKey"
       FROM video_reviews WHERE id = $1 AND org_id = $2`,
      [reviewId, orgId],
    );
    const row = review.rows[0];
    if (!row) throw new HttpError(404, "Review not found");
    return { ...row, assignedTeamKeys: [] as string[] };
  }
}

async function loadReviews(client: PoolClient, orgId: string) {
  try {
    return await client.query<Omit<RescoutReview, "notes" | "scores">>(
      `SELECT r.id, r.title, r.url, r.video_id AS "videoId", r.match_key AS "matchKey", r.team_key AS "teamKey",
              COALESCE(r.assigned_team_keys, '{}'::text[]) AS "assignedTeamKeys",
              r.notes AS "summary", u.name AS "createdByName", r.updated_at::text AS "updatedAt"
       FROM video_reviews r
       LEFT JOIN users u ON u.id = r.created_by
       WHERE r.org_id = $1
       ORDER BY r.updated_at DESC
       LIMIT 100`,
      [orgId],
    );
  } catch (error) {
    if (!isMissingSchema(error)) throw error;
    const fallback = await client.query<Omit<RescoutReview, "notes" | "scores" | "assignedTeamKeys">>(
      `SELECT r.id, r.title, r.url, r.video_id AS "videoId", r.match_key AS "matchKey", r.team_key AS "teamKey",
              r.notes AS "summary", u.name AS "createdByName", r.updated_at::text AS "updatedAt"
       FROM video_reviews r
       LEFT JOIN users u ON u.id = r.created_by
       WHERE r.org_id = $1
       ORDER BY r.updated_at DESC
       LIMIT 100`,
      [orgId],
    );
    return {
      rows: fallback.rows.map((row) => ({ ...row, assignedTeamKeys: [] as string[] })),
    };
  }
}

async function loadNotes(client: PoolClient, orgId: string): Promise<Map<string, VideoNote[]>> {
  const rows = await client.query<VideoNote>(
    `SELECT n.id, n.review_id AS "reviewId", n.at_seconds AS "atSeconds", n.tag, n.body,
            u.name AS "createdByName", n.created_at::text AS "createdAt"
     FROM video_notes n
     LEFT JOIN users u ON u.id = n.created_by
     WHERE n.org_id = $1
     ORDER BY n.review_id, n.at_seconds`,
    [orgId],
  );
  const byReview = new Map<string, VideoNote[]>();
  for (const entry of rows.rows) {
    const list = byReview.get(entry.reviewId) ?? [];
    list.push(entry);
    byReview.set(entry.reviewId, list);
  }
  return byReview;
}

async function loadScores(client: PoolClient, orgId: string, reviewId?: string): Promise<Map<string, TimelineScore[]>> {
  try {
    const rows = reviewId
      ? await client.query<TimelineScore>(
          `SELECT s.id, s.review_id AS "reviewId", s.team_key AS "teamKey", s.at_seconds AS "atSeconds",
                  s.field_key AS "fieldKey", s.value, u.name AS "createdByName", s.created_at::text AS "createdAt"
           FROM video_timeline_scores s
           LEFT JOIN users u ON u.id = s.created_by
           WHERE s.org_id = $1 AND s.review_id = $2
           ORDER BY s.at_seconds, s.created_at, s.id`,
          [orgId, reviewId],
        )
      : await client.query<TimelineScore>(
          `SELECT s.id, s.review_id AS "reviewId", s.team_key AS "teamKey", s.at_seconds AS "atSeconds",
                  s.field_key AS "fieldKey", s.value, u.name AS "createdByName", s.created_at::text AS "createdAt"
           FROM video_timeline_scores s
           LEFT JOIN users u ON u.id = s.created_by
           WHERE s.org_id = $1
           ORDER BY s.review_id, s.at_seconds, s.created_at, s.id`,
          [orgId],
        );
    const byReview = new Map<string, TimelineScore[]>();
    for (const entry of sortTimelineScores(rows.rows)) {
      const list = byReview.get(entry.reviewId) ?? [];
      list.push(entry);
      byReview.set(entry.reviewId, list);
    }
    return byReview;
  } catch (error) {
    if (!isMissingSchema(error)) throw error;
    return new Map();
  }
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
          message: "Select a team to re-scout match video.",
          context: { orgId: null, orgName: null, teamNumber: null, role: null },
        } satisfies RescoutView;
      }

      const [reviews, notesByReview, scoresByReview, eventRow, schemaRow] = await Promise.all([
        loadReviews(client, row.orgId),
        loadNotes(client, row.orgId),
        loadScores(client, row.orgId),
        client.query<{ eventKey: string | null }>(
          `SELECT active_event_key AS "eventKey" FROM org_active_context WHERE org_id = $1`,
          [row.orgId],
        ),
        client.query<{ id: string; definition: SchemaDefinition }>(
          `SELECT DISTINCT ON (type) id, schema AS definition
           FROM scout_schemas
           WHERE org_id = $1 AND type = 'match'
           ORDER BY type, version DESC`,
          [row.orgId],
        ),
      ]);

      const schema = schemaRow.rows[0];
      const matchSchema = schema
        ? {
            id: schema.id,
            title: schema.definition.title,
            fields: schema.definition.fields.map((field) => ({
              key: field.key,
              label: field.label,
              type: field.type,
              options: field.options,
            })),
          }
        : null;

      const assembled: RescoutReview[] = reviews.rows.map((review) => ({
        ...review,
        notes: sortNotes(notesByReview.get(review.id) ?? []),
        scores: scoresByReview.get(review.id) ?? [],
      }));

      return {
        status: "ready",
        context: {
          orgId: row.orgId,
          orgName: row.orgName,
          teamNumber: row.teamNumber,
          role: row.role,
        },
        eventKey: eventRow.rows[0]?.eventKey ?? null,
        matchSchema,
        reviews: assembled,
      } satisfies RescoutView;
    });

    return Response.json(view);
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireSession();
    const action = parseVideoRescoutAction(await request.json());
    const userId = session.user.id;

    const result = await withRls({ userId, orgId: action.orgId }, async (client) => {
      await requireMembership(client, action.orgId, userId);

      switch (action.action) {
        case "set_assigned_teams": {
          await loadReview(client, action.orgId, action.reviewId);
          try {
            await client.query(
              `UPDATE video_reviews
               SET assigned_team_keys = $3::text[], updated_at = now()
               WHERE id = $1 AND org_id = $2`,
              [action.reviewId, action.orgId, action.teamKeys],
            );
          } catch (error) {
            if (!isMissingSchema(error)) throw error;
            throw new HttpError(503, "Video re-scout migration pending — assigned teams are not available yet.");
          }
          return { assignedTeamKeys: action.teamKeys };
        }

        case "add_score": {
          await loadReview(client, action.orgId, action.reviewId);
          try {
            const inserted = await client.query<{ id: string }>(
              `INSERT INTO video_timeline_scores
                (org_id, review_id, team_key, at_seconds, field_key, value, created_by)
               VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
               RETURNING id`,
              [
                action.orgId,
                action.reviewId,
                action.teamKey,
                action.atSeconds,
                action.fieldKey,
                JSON.stringify(action.value),
                userId,
              ],
            );
            await client.query(`UPDATE video_reviews SET updated_at = now() WHERE id = $1 AND org_id = $2`, [
              action.reviewId,
              action.orgId,
            ]);
            return { id: inserted.rows[0]!.id };
          } catch (error) {
            if (!isMissingSchema(error)) throw error;
            throw new HttpError(503, "Video re-scout migration pending — timeline scores are not available yet.");
          }
        }

        case "delete_score": {
          try {
            const deleted = await client.query<{ reviewId: string }>(
              `DELETE FROM video_timeline_scores
               WHERE id = $1 AND org_id = $2
               RETURNING review_id AS "reviewId"`,
              [action.id, action.orgId],
            );
            if (!deleted.rowCount) throw new HttpError(404, "Score not found");
            await client.query(`UPDATE video_reviews SET updated_at = now() WHERE id = $1 AND org_id = $2`, [
              deleted.rows[0]!.reviewId,
              action.orgId,
            ]);
            return { ok: true };
          } catch (error) {
            if (!isMissingSchema(error)) throw error;
            throw new HttpError(503, "Video re-scout migration pending — timeline scores are not available yet.");
          }
        }

        case "commit_rescout": {
          const review = await loadReview(client, action.orgId, action.reviewId);
          if (!review.matchKey) throw new HttpError(400, "Review must be linked to a match before commit");
          if (!review.assignedTeamKeys.length) {
            throw new HttpError(400, "Assign at least one team before committing re-scout");
          }
          const match = await client.query<{ eventKey: string }>(
            `SELECT event_key AS "eventKey" FROM matches_ref WHERE match_key = $1`,
            [review.matchKey],
          );
          const eventKey = match.rows[0]?.eventKey;
          if (!eventKey) throw new HttpError(400, "Match not found in reference cache");

          const repository = new ScoutingRepository(client);
          const schema = await repository.getSchema(action.orgId, action.schemaId);
          if (schema.type !== "match") throw new HttpError(400, "Schema must be a match schema");

          const scores = (await loadScores(client, action.orgId, action.reviewId)).get(action.reviewId) ?? [];
          const syncEntries = buildVideoRescoutSyncEntries({
            reviewId: action.reviewId,
            eventKey,
            matchKey: review.matchKey,
            schemaId: action.schemaId,
            assignedTeamKeys: review.assignedTeamKeys,
            scores,
            schema: schema.definition,
            confidence: action.confidence,
          });

          const acknowledgements = [];
          for (const entry of syncEntries) {
            acknowledgements.push(await repository.syncEntry(action.orgId, userId, entry));
          }
          await client.query(`UPDATE video_reviews SET updated_at = now() WHERE id = $1 AND org_id = $2`, [
            action.reviewId,
            action.orgId,
          ]);
          return { acknowledgements, entryCount: syncEntries.length };
        }

        default:
          throw new HttpError(400, "Unsupported video re-scout action");
      }
    });

    return Response.json(result);
  } catch (error) {
    return fail(error);
  }
}
