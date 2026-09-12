// /api/learning/mentor — the /learning page's data: a mentor foreman rollup
// plus the caller's own calls.
//
// Everyone gets THEIR OWN calls, per-surface trend, and rollup — a student is
// never scored on anything they cannot see about themselves. The org-wide
// rollup, call feed, and "learning mode is off for N students" note exist ONLY
// for owners/admins (canReadOrgCalls); RLS enforces the same boundary at the
// row level, so the guard here is belt on top of braces.
//
// Nothing here writes anything. All judgement lives in the pure aggregators
// (mentor-view.ts): a documented flag rule over a stated minimum sample, and
// "not enough calls yet" below it — never a fabricated score.

import type { PoolClient } from "@neondatabase/serverless";
import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  canReadOrgCalls,
  defaultLearningModeEnabled,
  LEARNING_SURFACES,
  learningSurfaceLabel,
  roleTier,
  type LearningSurface,
} from "../../../../lib/learning/learning-mode";
import {
  buildMentorRollup,
  summarizeLearningModeOff,
  type LearningModeNote,
  type MemberModeRow,
  type MemberRollup,
  type MentorViewCallRow,
} from "../../../../lib/learning/mentor-view";
import {
  summarizeAccuracyTrend,
  type AccuracyTrend,
  type Closeness,
  type PastCall,
} from "../../../../lib/learning/predictions";

/** How far back the rollup looks. Windowed, and the response says so. */
const ROLLUP_WINDOW_ROWS = 400;
const OWN_WINDOW_ROWS = 60;
const FEED_LIMIT = 25;
const TREND_WINDOW = 5;

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function fail(error: unknown) {
  const status = error instanceof HttpError ? error.status : 400;
  return Response.json(
    { error: error instanceof Error ? error.message : "Learning overview request failed" },
    { status },
  );
}

type MembershipRow = { orgId: string; orgName: string; role: string };

async function resolveMembership(
  client: PoolClient,
  userId: string,
  requestedOrg: string | null,
): Promise<MembershipRow | null> {
  const result = await client.query<MembershipRow>(
    `SELECT m.org_id AS "orgId", o.name AS "orgName", m.role
       FROM memberships m JOIN organizations o ON o.id = m.org_id
      WHERE m.user_id = $1::uuid AND ($2::uuid IS NULL OR m.org_id = $2::uuid)
      ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, o.team_number
      LIMIT 1`,
    [userId, requestedOrg],
  );
  return result.rows[0] ?? null;
}

type CallRowRaw = {
  id: string;
  userId: string;
  userName: string | null;
  surface: LearningSurface;
  closeness: Closeness | null;
  skipped: boolean;
  createdAt: string;
};

export type LearningFeedRow = {
  id: string;
  userId: string;
  userName: string | null;
  surface: LearningSurface;
  surfaceLabel: string;
  closeness: Closeness | null;
  skipped: boolean;
  createdAt: string;
};

export type SurfaceTrend = {
  surface: LearningSurface;
  surfaceLabel: string;
  trend: AccuracyTrend;
};

export type LearningOverview =
  | { status: "setup_required"; message: string }
  | {
      status: "ready";
      context: {
        orgId: string;
        orgName: string;
        role: string;
        tier: "mentor" | "student";
        canReadOrgCalls: boolean;
      };
      /** The caller's OWN calls — present for every tier. */
      mine: {
        rollup: MemberRollup | null;
        trends: SurfaceTrend[];
        recent: LearningFeedRow[];
      };
      /** Mentor-only foreman view; null for student-tier viewers. */
      org: null | {
        members: MemberRollup[];
        feed: LearningFeedRow[];
        modeNote: LearningModeNote;
        /** Honest scope statement: the rollup is windowed, not all-time. */
        windowNote: string;
      };
    };

const toFeedRow = (row: CallRowRaw): LearningFeedRow => ({
  id: row.id,
  userId: row.userId,
  userName: row.userName,
  surface: row.surface,
  surfaceLabel: learningSurfaceLabel(row.surface),
  closeness: row.closeness,
  skipped: row.skipped,
  createdAt: row.createdAt,
});

const toMentorRow = (row: CallRowRaw): MentorViewCallRow => ({
  userId: row.userId,
  userName: row.userName,
  surface: row.surface,
  closeness: row.closeness,
  skipped: row.skipped,
  createdAt: row.createdAt,
});

/** GET /api/learning/mentor?orgId=… */
export async function GET(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) throw new HttpError(401, "Authentication required");
    const requestedOrg = new URL(request.url).searchParams.get("orgId");

    const view = await withRls({ userId: session.user.id }, async (client): Promise<LearningOverview> => {
      const membership = await resolveMembership(client, session.user.id, requestedOrg);
      if (!membership) {
        return {
          status: "setup_required",
          message: "Join a team to see Learning activity.",
        };
      }
      const mentor = canReadOrgCalls(membership.role);

      // Rows are created_at::text so the pure aggregators compare/format
      // strings deterministically (no Date parsing on the server).
      const mineResult = await client.query<CallRowRaw>(
        `SELECT p.id, p.user_id AS "userId", u.name AS "userName", p.surface,
                p.closeness, p.skipped, p.created_at::text AS "createdAt"
           FROM learning_predictions p JOIN users u ON u.id = p.user_id
          WHERE p.org_id = $1::uuid AND p.user_id = $2::uuid
          ORDER BY p.created_at DESC
          LIMIT $3`,
        [membership.orgId, session.user.id, OWN_WINDOW_ROWS],
      );
      const mineRows = mineResult.rows;

      const trends: SurfaceTrend[] = LEARNING_SURFACES.map((surface) => ({
        surface,
        surfaceLabel: learningSurfaceLabel(surface),
        trend: summarizeAccuracyTrend(
          mineRows
            .filter((row) => row.surface === surface)
            .slice(0, TREND_WINDOW)
            .map<PastCall>((row) => ({
              closeness: row.closeness,
              skipped: row.skipped,
              createdAt: row.createdAt,
            })),
          TREND_WINDOW,
        ),
      }));

      const mine = {
        rollup: buildMentorRollup(mineRows.map(toMentorRow))[0] ?? null,
        trends,
        recent: mineRows.slice(0, FEED_LIMIT).map(toFeedRow),
      };

      let org: Extract<LearningOverview, { status: "ready" }>["org"] = null;
      if (mentor) {
        const [orgResult, modeResult] = await Promise.all([
          client.query<CallRowRaw>(
            `SELECT p.id, p.user_id AS "userId", u.name AS "userName", p.surface,
                    p.closeness, p.skipped, p.created_at::text AS "createdAt"
               FROM learning_predictions p JOIN users u ON u.id = p.user_id
              WHERE p.org_id = $1::uuid
              ORDER BY p.created_at DESC
              LIMIT $2`,
            [membership.orgId, ROLLUP_WINDOW_ROWS],
          ),
          // Resolved member DEFAULT only (surface IS NULL): per-surface
          // overrides may still differ, and device-only choices from before
          // phase 2 are invisible to the server — the note's copy stays honest
          // about being a visibility aid, not a control.
          client.query<{ userId: string; userName: string | null; role: string; enabled: boolean | null }>(
            `SELECT m.user_id AS "userId", u.name AS "userName", m.role, p.enabled
               FROM memberships m
               JOIN users u ON u.id = m.user_id
               LEFT JOIN learning_mode_prefs p
                 ON p.org_id = m.org_id AND p.user_id = m.user_id AND p.surface IS NULL
              WHERE m.org_id = $1::uuid`,
            [membership.orgId],
          ),
        ]);

        const modeRows: MemberModeRow[] = modeResult.rows.map((row) => ({
          userId: row.userId,
          userName: row.userName,
          role: row.role,
          enabled: row.enabled ?? defaultLearningModeEnabled(row.role),
        }));

        org = {
          members: buildMentorRollup(orgResult.rows.map(toMentorRow)),
          feed: orgResult.rows.slice(0, FEED_LIMIT).map(toFeedRow),
          modeNote: summarizeLearningModeOff(modeRows),
          windowNote:
            orgResult.rows.length >= ROLLUP_WINDOW_ROWS
              ? `Rollup covers the most recent ${ROLLUP_WINDOW_ROWS} calls, not all time.`
              : "Rollup covers every call recorded so far.",
        };
      }

      return {
        status: "ready",
        context: {
          orgId: membership.orgId,
          orgName: membership.orgName,
          role: membership.role,
          tier: roleTier(membership.role),
          canReadOrgCalls: mentor,
        },
        mine,
        org,
      };
    });

    return Response.json(view);
  } catch (error) {
    if (error instanceof HttpError) return fail(error);
    // No database (or an unreachable one) is a setup state, not a crash:
    // the page says what to configure instead of pretending anything.
    return Response.json(
      {
        status: "setup_required",
        message:
          "Could not load learning activity. Choose your team and confirm database access.",
      } satisfies LearningOverview,
      { status: 200 },
    );
  }
}
