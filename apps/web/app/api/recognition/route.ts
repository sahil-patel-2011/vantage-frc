import type { PoolClient } from "@neondatabase/serverless";
import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { parseRecognitionAction, tallyAward, type RecognitionStage } from "../../../lib/recognition";

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
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

async function awardStage(client: PoolClient, awardId: string, orgId: string): Promise<RecognitionStage> {
  const row = await client.query<{ stage: RecognitionStage }>(`SELECT stage FROM recognition_awards WHERE id = $1 AND org_id = $2`, [awardId, orgId]);
  if (!row.rowCount) throw new HttpError(404, "Award not found");
  return row.rows[0]!.stage;
}

function fail(error: unknown) {
  const status = error instanceof HttpError ? error.status : 400;
  return Response.json({ error: error instanceof Error ? error.message : "Recognition request failed" }, { status });
}

type AwardRow = { id: string; seasonYear: number; name: string; description: string; stage: RecognitionStage; byName: string | null };
type NomRow = { id: string; awardId: string; nomineeName: string; reason: string };
type VoteRow = { awardId: string; nominationId: string; voterUserId: string };

export async function GET(request: Request) {
  try {
    const session = await requireSession();
    const url = new URL(request.url);
    const requestedOrg = url.searchParams.get("orgId");
    const seasonYear = Number(url.searchParams.get("seasonYear") ?? new Date().getFullYear());

    const view = await withRls({ userId: session.user.id }, async (client) => {
      const membership = await client.query<{ orgId: string; orgName: string; role: string }>(
        `SELECT m.org_id AS "orgId", o.name AS "orgName", m.role
         FROM memberships m JOIN organizations o ON o.id = m.org_id
         WHERE m.user_id = $1 AND ($2::uuid IS NULL OR m.org_id = $2::uuid)
         ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, o.team_number
         LIMIT 1`,
        [session.user.id, requestedOrg],
      );
      const row = membership.rows[0];
      if (!row) return { status: "setup_required" as const, message: "Choose your team to run team awards." };

      const [awards, noms, votes] = await Promise.all([
        client.query<AwardRow>(
          `SELECT a.id, a.season_year AS "seasonYear", a.name, a.description, a.stage, u.name AS "byName"
           FROM recognition_awards a LEFT JOIN users u ON u.id = a.created_by
           WHERE a.org_id = $1 AND a.season_year = $2 ORDER BY a.created_at`,
          [row.orgId, seasonYear],
        ),
        client.query<NomRow>(
          `SELECT n.id, n.award_id AS "awardId", n.nominee_name AS "nomineeName", n.reason
           FROM recognition_nominations n JOIN recognition_awards a ON a.id = n.award_id
           WHERE n.org_id = $1 AND a.season_year = $2 ORDER BY n.created_at`,
          [row.orgId, seasonYear],
        ),
        client.query<VoteRow>(
          `SELECT v.award_id AS "awardId", v.nomination_id AS "nominationId", v.voter_user_id AS "voterUserId"
           FROM recognition_votes v JOIN recognition_awards a ON a.id = v.award_id
           WHERE v.org_id = $1 AND a.season_year = $2`,
          [row.orgId, seasonYear],
        ),
      ]);

      const awardsWithTally = awards.rows.map((award) => {
        const awardNoms = noms.rows.filter((n) => n.awardId === award.id);
        const awardVotes = votes.rows.filter((v) => v.awardId === award.id);
        const tally = tallyAward(awardNoms, awardVotes, award.stage);
        const myVote = awardVotes.find((v) => v.voterUserId === session.user.id)?.nominationId ?? null;
        return { ...award, ...tally, myVote };
      });

      return {
        status: "ready" as const,
        context: { orgId: row.orgId, role: row.role, canManage: row.role === "owner" || row.role === "admin" },
        seasonYear,
        awards: awardsWithTally,
      };
    });

    return Response.json(view);
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireSession();
    const action = parseRecognitionAction(await request.json());
    const userId = session.user.id;

    const result = await withRls({ userId, orgId: action.orgId }, async (client) => {
      await requireMembership(client, action.orgId, userId);

      switch (action.action) {
        case "create_award": {
          // RLS restricts this to owner/admin; surface a clean message if blocked.
          const inserted = await client.query<{ id: string }>(
            `INSERT INTO recognition_awards (org_id, season_year, name, description, created_by)
             VALUES ($1, $2, $3, $4, $5) RETURNING id`,
            [action.orgId, action.seasonYear, action.name, action.description, userId],
          );
          return { id: inserted.rows[0]!.id };
        }
        case "set_stage": {
          const updated = await client.query(
            `UPDATE recognition_awards SET stage = $1, updated_at = now() WHERE id = $2 AND org_id = $3`,
            [action.stage, action.id, action.orgId],
          );
          if (!updated.rowCount) throw new HttpError(404, "Award not found");
          return { ok: true };
        }
        case "delete_award": {
          const deleted = await client.query(`DELETE FROM recognition_awards WHERE id = $1 AND org_id = $2`, [action.id, action.orgId]);
          if (!deleted.rowCount) throw new HttpError(403, "You cannot delete this award");
          return { ok: true };
        }
        case "add_nomination": {
          if ((await awardStage(client, action.awardId, action.orgId)) !== "nominating") throw new HttpError(400, "Nominations are closed for this award");
          const inserted = await client.query<{ id: string }>(
            `INSERT INTO recognition_nominations (org_id, award_id, nominee_name, reason, nominated_by)
             VALUES ($1, $2, $3, $4, $5) RETURNING id`,
            [action.orgId, action.awardId, action.nomineeName, action.reason, userId],
          );
          return { id: inserted.rows[0]!.id };
        }
        case "delete_nomination": {
          const deleted = await client.query(`DELETE FROM recognition_nominations WHERE id = $1 AND org_id = $2`, [action.id, action.orgId]);
          if (!deleted.rowCount) throw new HttpError(403, "You cannot delete this nomination");
          return { ok: true };
        }
        case "cast_vote": {
          if ((await awardStage(client, action.awardId, action.orgId)) !== "voting") throw new HttpError(400, "Voting is not open for this award");
          const nom = await client.query(`SELECT 1 FROM recognition_nominations WHERE id = $1 AND award_id = $2`, [action.nominationId, action.awardId]);
          if (!nom.rowCount) throw new HttpError(404, "Nomination not found for this award");
          // One vote per member per award; a repeat vote moves the ballot.
          await client.query(
            `INSERT INTO recognition_votes (org_id, award_id, nomination_id, voter_user_id)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (award_id, voter_user_id) DO UPDATE SET nomination_id = excluded.nomination_id, created_at = now()`,
            [action.orgId, action.awardId, action.nominationId, userId],
          );
          return { ok: true };
        }
        default:
          throw new HttpError(400, "Unsupported recognition action");
      }
    });

    return Response.json(result);
  } catch (error) {
    return fail(error);
  }
}
