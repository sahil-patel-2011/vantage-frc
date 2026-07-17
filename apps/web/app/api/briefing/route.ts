import type { PoolClient } from "@neondatabase/serverless";
import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  matchLabel,
  normalizePlan,
  ourAllianceOf,
  practiceReadiness,
  type BriefingMatch,
  type BriefingPrediction,
  type BriefingView,
  type OpponentIntel,
} from "../../../lib/briefing";
import type { DriverCycle, DriverSession } from "../../../lib/driver-practice";

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

function fail(error: unknown) {
  const status = error instanceof HttpError ? error.status : 400;
  return Response.json({ error: error instanceof Error ? error.message : "Briefing request failed" }, { status });
}

type AllianceJson = { teamKeys?: unknown; score?: unknown } | null;

function teamKeysOf(alliance: AllianceJson): string[] {
  const keys = alliance?.teamKeys;
  if (!Array.isArray(keys)) return [];
  return keys.map((key) => String(key));
}

function allianceScore(alliance: AllianceJson): number | null {
  const score = alliance?.score;
  return score == null ? null : Number(score);
}

/** Defensive narrow of the stored key_factors JSONB into the briefing shape. */
function normalizeKeyFactors(value: unknown): BriefingPrediction["keyFactors"] {
  if (!Array.isArray(value)) return [];
  const factors: BriefingPrediction["keyFactors"] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const record = entry as Record<string, unknown>;
    const name = typeof record.name === "string" ? record.name.trim() : "";
    if (!name) continue;
    const impact = Number(record.impact);
    factors.push({
      name,
      alliance: typeof record.alliance === "string" ? record.alliance : "",
      impact: Number.isFinite(impact) ? impact : 0,
      evidence: typeof record.evidence === "string" ? record.evidence : "",
    });
  }
  return factors.slice(0, 6);
}

/** Defensive narrow of the stored caveats JSONB into a string array. */
function normalizeCaveats(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0).slice(0, 8);
}

/** Opponent film: reviews tagged with an opponent team or linked to this match. */
async function loadOpponentIntel(
  client: PoolClient,
  orgId: string,
  matchKey: string,
  opponents: string[],
): Promise<OpponentIntel[]> {
  const reviews = await client.query<{ id: string; title: string; teamKey: string | null }>(
    `SELECT r.id, r.title, r.team_key AS "teamKey"
     FROM video_reviews r
     WHERE r.org_id = $1 AND (r.team_key = ANY($2::text[]) OR r.match_key = $3)
     ORDER BY r.updated_at DESC
     LIMIT 6`,
    [orgId, opponents, matchKey],
  );
  if (reviews.rows.length === 0) return [];

  const notes = await client.query<{ reviewId: string; atSeconds: number; tag: string; body: string }>(
    `SELECT "reviewId", "atSeconds", tag, body FROM (
       SELECT n.review_id AS "reviewId", n.at_seconds AS "atSeconds", n.tag, n.body,
              row_number() OVER (PARTITION BY n.review_id ORDER BY n.at_seconds, n.created_at) AS note_rank
       FROM video_notes n
       WHERE n.org_id = $1 AND n.review_id = ANY($2::uuid[])
     ) ranked
     WHERE note_rank <= 8
     ORDER BY "reviewId", "atSeconds"`,
    [orgId, reviews.rows.map((row) => row.id)],
  );

  const byReview = new Map<string, OpponentIntel["notes"]>();
  for (const note of notes.rows) {
    const list = byReview.get(note.reviewId) ?? [];
    list.push({ atSeconds: Number(note.atSeconds), tag: note.tag, body: note.body });
    byReview.set(note.reviewId, list);
  }

  return reviews.rows.map((row) => ({
    teamKey: row.teamKey ?? "",
    reviewTitle: row.title,
    notes: byReview.get(row.id) ?? [],
  }));
}

const RECENT_SESSION_LIMIT = 40;

export async function GET(request: Request) {
  try {
    const session = await requireSession();
    const url = new URL(request.url);
    const requestedOrg = url.searchParams.get("orgId");
    const requestedMatch = url.searchParams.get("matchKey");

    const view = await withRls({ userId: session.user.id }, async (client) => {
      const membership = await client.query<{
        orgId: string;
        orgName: string;
        teamNumber: number | null;
        role: string;
        eventKey: string | null;
        eventName: string | null;
      }>(
        `SELECT m.org_id AS "orgId", o.name AS "orgName", o.team_number AS "teamNumber", m.role,
                c.active_event_key AS "eventKey", e.name AS "eventName"
         FROM memberships m
         JOIN organizations o ON o.id = m.org_id
         LEFT JOIN org_active_context c ON c.org_id = o.id
         LEFT JOIN events_ref e ON e.event_key = c.active_event_key
         WHERE m.user_id = $1 AND ($2::uuid IS NULL OR m.org_id = $2::uuid)
         ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, o.team_number
         LIMIT 1`,
        [session.user.id, requestedOrg],
      );

      const row = membership.rows[0];
      if (!row) {
        return {
          status: "setup_required",
          message: "Select a team workspace to open the pre-match briefing.",
          context: { orgId: null, orgName: null, teamNumber: null, role: null, eventKey: null, eventName: null },
        } satisfies BriefingView;
      }

      const context = {
        orgId: row.orgId,
        orgName: row.orgName,
        teamNumber: row.teamNumber,
        role: row.role,
        eventKey: row.eventKey,
        eventName: row.eventName,
      };

      if (!row.eventKey) {
        return { status: "setup_required", message: "Select an active event in Workspace.", context } satisfies BriefingView;
      }
      if (row.teamNumber == null) {
        return {
          status: "setup_required",
          message: "Set your team number in Workspace so the briefing knows which alliance is yours.",
          context,
        } satisfies BriefingView;
      }
      const teamKey = `frc${row.teamNumber}`;

      const matches = await client.query<{
        matchKey: string;
        compLevel: string;
        matchNumber: number;
        scheduledTime: string | null;
        redAlliance: AllianceJson;
        blueAlliance: AllianceJson;
      }>(
        `SELECT m.match_key AS "matchKey", m.comp_level AS "compLevel", m.match_number AS "matchNumber",
                COALESCE(m.actual_time, m.predicted_time, m.event_time)::text AS "scheduledTime",
                m.red_alliance AS "redAlliance", m.blue_alliance AS "blueAlliance"
         FROM matches_ref m
         WHERE m.event_key = $1
         ORDER BY CASE m.comp_level
                    WHEN 'qm' THEN 0 WHEN 'ef' THEN 1 WHEN 'qf' THEN 2
                    WHEN 'sf' THEN 3 WHEN 'f' THEN 4 ELSE 5
                  END, m.match_number`,
        [row.eventKey],
      );

      const ourRows = matches.rows
        .map((entry) => ({
          matchKey: entry.matchKey,
          compLevel: entry.compLevel,
          matchNumber: entry.matchNumber,
          scheduledTime: entry.scheduledTime,
          red: teamKeysOf(entry.redAlliance),
          blue: teamKeysOf(entry.blueAlliance),
          redScore: allianceScore(entry.redAlliance),
          blueScore: allianceScore(entry.blueAlliance),
        }))
        .filter((entry) => entry.red.includes(teamKey) || entry.blue.includes(teamKey));

      const selected =
        ourRows.find((entry) => entry.matchKey === requestedMatch) ??
        ourRows.find((entry) => entry.redScore == null || entry.blueScore == null) ??
        ourRows[0];
      if (!selected) {
        return {
          status: "setup_required",
          message: "No matches for your team at this event yet — sync TBA first.",
          context,
        } satisfies BriefingView;
      }

      const match: BriefingMatch = {
        matchKey: selected.matchKey,
        compLevel: selected.compLevel,
        matchNumber: selected.matchNumber,
        scheduledTime: selected.scheduledTime,
        red: selected.red,
        blue: selected.blue,
      };
      const ourAlliance = ourAllianceOf(match, teamKey);
      const opponents = ourAlliance === "red" ? match.blue : ourAlliance === "blue" ? match.red : [];

      const [prediction, strategy, play, sessions, cycles, opponentIntel, scoutCount] = await Promise.all([
        client.query<{
          pRed: number;
          pBlue: number;
          confidenceLow: number;
          confidenceHigh: number;
          modelVersion: string;
          keyFactors: unknown;
          caveats: unknown;
          scoredAt: string | null;
        }>(
          `SELECT p.p_red AS "pRed", p.p_blue AS "pBlue",
                  p.confidence_low AS "confidenceLow", p.confidence_high AS "confidenceHigh",
                  p.model_version AS "modelVersion", p.key_factors AS "keyFactors",
                  p.caveats, p.scored_at::text AS "scoredAt"
           FROM predictions p
           WHERE p.org_id = $1 AND p.match_key = $2
           ORDER BY p.scored_at DESC
           LIMIT 1`,
          [row.orgId, match.matchKey],
        ),
        client.query<{ plan: unknown }>(
          `SELECT s.plan FROM match_strategies s
           WHERE s.org_id = $1 AND s.match_key = $2
           ORDER BY s.updated_at DESC
           LIMIT 1`,
          [row.orgId, match.matchKey],
        ),
        client.query<{ id: string; title: string; description: string; strokeCount: number | null; updatedAt: string }>(
          `SELECT p.id, p.title, p.description,
                  CASE WHEN jsonb_typeof(p.strokes) = 'array' THEN jsonb_array_length(p.strokes) ELSE 0 END AS "strokeCount",
                  p.updated_at::text AS "updatedAt"
           FROM whiteboard_plays p
           WHERE p.org_id = $1 AND p.match_key = $2
           ORDER BY p.updated_at DESC
           LIMIT 1`,
          [row.orgId, match.matchKey],
        ),
        client.query<Omit<DriverSession, "cycles">>(
          `SELECT s.id, s.title, s.event_key AS "eventKey", s.session_date::text AS "sessionDate",
                  s.driver_user_id AS "driverUserId", s.driver_name AS "driverName",
                  s.location, s.goal, s.notes, s.created_at::text AS "createdAt", s.updated_at::text AS "updatedAt"
           FROM driver_sessions s
           WHERE s.org_id = $1
           ORDER BY s.session_date DESC, s.created_at DESC
           LIMIT ${RECENT_SESSION_LIMIT}`,
          [row.orgId],
        ),
        client.query<DriverCycle>(
          `SELECT c.id, c.session_id AS "sessionId", c.action, c.seconds::float8 AS seconds, c.success,
                  c.note, c.rep_index AS "repIndex", c.created_at::text AS "createdAt"
           FROM driver_cycles c
           WHERE c.org_id = $1
             AND c.session_id IN (
               SELECT id FROM driver_sessions
               WHERE org_id = $1
               ORDER BY session_date DESC, created_at DESC
               LIMIT ${RECENT_SESSION_LIMIT}
             )
           ORDER BY c.session_id, c.rep_index, c.created_at`,
          [row.orgId],
        ),
        loadOpponentIntel(client, row.orgId, match.matchKey, opponents),
        client.query<{ count: number }>(
          `SELECT count(*)::int AS count FROM scout_assignments WHERE org_id = $1 AND match_key = $2`,
          [row.orgId, match.matchKey],
        ),
      ]);

      const predictionRow = prediction.rows[0];
      const briefingPrediction: BriefingPrediction | null = predictionRow
        ? {
            pRed: Number(predictionRow.pRed),
            pBlue: Number(predictionRow.pBlue),
            confidenceLow: Number(predictionRow.confidenceLow),
            confidenceHigh: Number(predictionRow.confidenceHigh),
            modelVersion: predictionRow.modelVersion,
            keyFactors: normalizeKeyFactors(predictionRow.keyFactors),
            caveats: normalizeCaveats(predictionRow.caveats),
            scoredAt: predictionRow.scoredAt,
          }
        : null;

      const playRow = play.rows[0];
      const bySession = new Map<string, DriverCycle[]>();
      for (const cycle of cycles.rows) {
        const list = bySession.get(cycle.sessionId) ?? [];
        list.push(cycle);
        bySession.set(cycle.sessionId, list);
      }
      const practiceSessions: DriverSession[] = sessions.rows.map((sessionRow) => ({
        ...sessionRow,
        cycles: bySession.get(sessionRow.id) ?? [],
      }));

      return {
        status: "ready",
        context,
        match,
        ourAlliance,
        prediction: briefingPrediction,
        plan: normalizePlan(strategy.rows[0]?.plan),
        play: playRow
          ? {
              id: playRow.id,
              title: playRow.title,
              description: playRow.description,
              strokeCount: playRow.strokeCount == null ? 0 : Number(playRow.strokeCount),
              updatedAt: playRow.updatedAt,
            }
          : null,
        practice: practiceReadiness(practiceSessions),
        opponentIntel,
        scoutCount: scoutCount.rows[0] ? Number(scoutCount.rows[0].count) : 0,
        ourMatches: ourRows.map((entry) => ({
          matchKey: entry.matchKey,
          label: matchLabel(entry.compLevel, entry.matchNumber),
        })),
      } satisfies BriefingView;
    });

    return Response.json(view);
  } catch (error) {
    return fail(error);
  }
}
