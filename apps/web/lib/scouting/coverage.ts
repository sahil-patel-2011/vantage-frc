// THE coverage read/write compute behind /scouting/lineup.
//
// /scouting/lineup polled /api/scouting/coverage, which never existed, so the page 404'd in a
// loop while /scout-coverage-live sat next to it with a second, differently-shaped model. This
// module is the one canonical coverage compute for the lineup shape: it reuses the pure slot
// assembly already in lineup-related.ts (buildLineupCoverageSlots / defaultLineupFocusMatchKey)
// and the shared gap math in @vantage/scouting/coverage, and writes assignments to the existing
// scout_assignments table — no new coverage data model.
//
// Request-path only: parameterized SQL through the PoolClient handed out by withRls, never
// @vantage/db/admin. Every statement is org-scoped in addition to RLS.

import type { PoolClient } from "@neondatabase/serverless";
import {
  buildCoverageGapBoard,
  focusLiveCoverage,
  summarizeCoverageGaps,
  type CoverageGapSlot,
  type CoverageGapSummary,
} from "@vantage/scouting/coverage";
import {
  buildLineupCoverageSlots,
  defaultLineupFocusMatchKey,
  type LineupAssignmentCountRow,
  type LineupEntryScoutRow,
  type LineupMatchRow,
} from "./lineup-related";
import { resolveScoutOrg } from "../scout-org-access";
import { matchStillAheadSql } from "../matches/match-ahead-sql";
import { loadScoutRoleCoverage, type ScoutRoleCoverage } from "./schema-role-coverage";
import {
  compareCoverageByWatchlist,
  loadWatchlistTeamKeys,
  orderCoverageByWatchlist,
  watchlistTeamKeys,
} from "../watchlist";

export type CoverageSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

/** A member who may be handed a coverage slot, with their current load at this event. */
export type CoverageScout = {
  userId: string;
  name: string;
  role: string;
  assignedCount: number;
  isMe: boolean;
};

export type ScoutingCoverageView =
  | {
      status: "setup_required";
      orgId: string | null;
      eventKey: null;
      generatedAt: string;
      message: string;
      steps: CoverageSetupStep[];
    }
  | {
      status: "live";
      orgId: string;
      teamNumber: number | null;
      eventKey: string;
      eventName: string | null;
      generatedAt: string;
      qualsOnly: boolean;
      /** True when this member's role may write scout_assignments (owner/admin only). */
      canAssign: boolean;
      summary: CoverageGapSummary;
      live: {
        focusMatchKeys: string[];
        focusSlots: CoverageGapSlot[];
        gapSlots: CoverageGapSlot[];
        doubleSlots: CoverageGapSlot[];
      };
      slots: CoverageGapSlot[];
      /**
       * Matches already played (a result is posted, or the field has moved
       * past them). Auto-assign skips them; the split below uses them.
       */
      playedMatchKeys: string[];
      /** The same robots counted two ways, so every heading can name its scope. */
      scope: CoverageScopeSummary;
      scouts: CoverageScout[];
      /**
       * Published-schema to strategy role gaps. Surfaced here because coverage is where a lead
       * notices "we scouted everything and strategy still shows nothing".
       */
      schemaRoles: ScoutRoleCoverage;
    };

export type CoverageQuery = {
  userId: string;
  requestedOrg: string | null;
  requestedEvent?: string | null;
  matchKey?: string | null;
  qualsOnly?: boolean;
  windowSize?: number;
  /**
   * Optional scout-queue priority. When omitted, keys are loaded from
   * opponent_watchlist_entries so a watched threat sorts earlier than schedule order.
   */
  priorityTeamKeys?: readonly string[] | null;
};

const COVERAGE_MATCH_LIMIT = 200;

/**
 * Coverage split by time. "Played" robots nobody scouted are lost for good;
 * "upcoming" robots with no scout yet are the ones a lead can still fix.
 */
export type CoverageScopeSummary = {
  playedMatches: number;
  /** Robot slots in played matches. */
  playedRobots: number;
  /** Robot slots in played matches with at least one report. */
  playedScouted: number;
  /** Robot slots in played matches with no report. */
  playedMissed: number;
  upcomingMatches: number;
  upcomingRobots: number;
  /** Upcoming robot slots with neither a scout assigned nor a report. */
  upcomingNoScout: number;
  /** Reports saved for matches not played yet (tests, or a scout ahead of the field). */
  reportsBeforePlay: number;
};

export function summarizeCoverageScope(
  slots: ReadonlyArray<Pick<CoverageGapSlot, "matchKey" | "status" | "assignmentCount" | "entryCount">>,
  playedMatchKeys: ReadonlySet<string>,
): CoverageScopeSummary {
  const played = new Set<string>();
  const upcoming = new Set<string>();
  const summary: CoverageScopeSummary = {
    playedMatches: 0,
    playedRobots: 0,
    playedScouted: 0,
    playedMissed: 0,
    upcomingMatches: 0,
    upcomingRobots: 0,
    upcomingNoScout: 0,
    reportsBeforePlay: 0,
  };
  for (const slot of slots) {
    const entries = Number(slot.entryCount) || 0;
    if (playedMatchKeys.has(slot.matchKey)) {
      played.add(slot.matchKey);
      summary.playedRobots += 1;
      if (entries > 0) summary.playedScouted += 1;
      else summary.playedMissed += 1;
    } else {
      upcoming.add(slot.matchKey);
      summary.upcomingRobots += 1;
      summary.reportsBeforePlay += entries;
      if (entries === 0 && (Number(slot.assignmentCount) || 0) === 0) summary.upcomingNoScout += 1;
    }
  }
  summary.playedMatches = played.size;
  summary.upcomingMatches = upcoming.size;
  return summary;
}

function setupRequired(
  message: string,
  orgId: string | null,
  steps: CoverageSetupStep[],
): ScoutingCoverageView {
  return {
    status: "setup_required",
    orgId,
    eventKey: null,
    generatedAt: new Date().toISOString(),
    message,
    steps,
  };
}

const WORKSPACE_STEP: CoverageSetupStep = {
  id: "workspace",
  label: "Choose your team",
  detail: "Choose your team.",
  href: "/workspace",
};

const EVENT_STEP: CoverageSetupStep = {
  id: "active-event",
  label: "Set active event",
  detail: "Pick the TBA event your team is competing at right now.",
  href: "/competition",
};

const SCHEDULE_STEP: CoverageSetupStep = {
  id: "schedule",
  label: "Sync event schedule",
  detail: "Match slots stay blank until TBA publishes and syncs the schedule.",
  href: "/competition",
};

export function canWriteAssignments(role: string | null | undefined): boolean {
  return role === "owner" || role === "admin";
}

async function resolveEventKey(
  client: PoolClient,
  orgId: string,
  requestedEvent: string | null,
): Promise<string | null> {
  if (requestedEvent) return requestedEvent;
  const result = await client.query<{ eventKey: string | null }>(
    `SELECT active_event_key AS "eventKey" FROM org_active_context WHERE org_id = $1::uuid`,
    [orgId],
  );
  return result.rows[0]?.eventKey ?? null;
}

async function loadScouts(
  client: PoolClient,
  input: { orgId: string; eventKey: string; userId: string },
): Promise<CoverageScout[]> {
  const result = await client.query<{
    userId: string;
    name: string | null;
    role: string;
    assignedCount: number | string;
  }>(
    `SELECT m.user_id AS "userId", u.name, m.role::text AS role,
            (SELECT count(*)::int FROM scout_assignments a
              WHERE a.org_id = m.org_id AND a.event_key = $2::text AND a.user_id = m.user_id)
              AS "assignedCount"
       FROM memberships m
       JOIN users u ON u.id = m.user_id
      WHERE m.org_id = $1::uuid
        AND m.role::text = ANY(ARRAY['owner','admin','scout'])
      ORDER BY u.name NULLS LAST, m.user_id`,
    [input.orgId, input.eventKey],
  );
  return result.rows.map((row) => ({
    userId: row.userId,
    name: row.name?.trim() || "Team member",
    role: row.role,
    assignedCount: Number(row.assignedCount) || 0,
    isMe: row.userId === input.userId,
  }));
}

/**
 * The one coverage read. Returns the exact shape /scouting/lineup renders; every count comes
 * from real matches_ref / scout_assignments / match_scout_entries rows, and attribution uses
 * membership user ids joined to users.name — never a typed scout name.
 */
export async function computeScoutingCoverageView(
  client: PoolClient,
  input: CoverageQuery,
): Promise<ScoutingCoverageView> {
  const org = await resolveScoutOrg(client, input.userId, input.requestedOrg);
  if (!org) {
    return setupRequired("Choose your team to see lineup coverage.", null, [
      WORKSPACE_STEP,
      EVENT_STEP,
    ]);
  }

  const eventKey = await resolveEventKey(client, org.orgId, input.requestedEvent ?? null);
  if (!eventKey) {
    return setupRequired("Set an active competition event to see lineup coverage.", org.orgId, [
      EVENT_STEP,
      SCHEDULE_STEP,
    ]);
  }

  const qualsOnly = input.qualsOnly !== false;

  const matches = await client.query<LineupMatchRow & { played?: boolean | null }>(
    `SELECT match_key AS "matchKey", comp_level AS "compLevel", set_number AS "setNumber",
            match_number AS "matchNumber",
            red_alliance AS "redAlliance", blue_alliance AS "blueAlliance",
            COALESCE(actual_time, predicted_time, event_time)::text AS "eventTime",
            NOT (${matchStillAheadSql()}) AS played
       FROM matches_ref
      WHERE event_key = $1::text
        AND ($2::boolean IS FALSE OR comp_level = 'qm')
      ORDER BY CASE comp_level
                 WHEN 'qm' THEN 0 WHEN 'ef' THEN 1 WHEN 'qf' THEN 2
                 WHEN 'sf' THEN 3 WHEN 'f' THEN 4 ELSE 5
               END, set_number, match_number
      LIMIT ${COVERAGE_MATCH_LIMIT}`,
    [eventKey, qualsOnly],
  );

  const matchKeys = matches.rows.map((row) => row.matchKey);

  const [assignments, entryScouts, scouts, schemaRoles, watchlistKeys, eventNameRow] = await Promise.all([
    matchKeys.length
      ? client.query<LineupAssignmentCountRow>(
          `SELECT match_key AS "matchKey", team_key AS "teamKey", count(*)::int AS count
             FROM scout_assignments
            WHERE org_id = $1::uuid AND event_key = $2::text AND match_key = ANY($3::text[])
            GROUP BY match_key, team_key`,
          [org.orgId, eventKey, matchKeys],
        )
      : Promise.resolve({ rows: [] as LineupAssignmentCountRow[] }),
    matchKeys.length
      ? client.query<LineupEntryScoutRow>(
          `SELECT e.match_key AS "matchKey", e.team_key AS "teamKey",
                  e.scout_user_id AS "scoutUserId", u.name AS "scoutName"
             FROM match_scout_entries e
             LEFT JOIN users u ON u.id = e.scout_user_id
            WHERE e.org_id = $1::uuid AND e.event_key = $2::text AND e.match_key = ANY($3::text[])
            ORDER BY e.match_key, e.team_key, e.created_at`,
          [org.orgId, eventKey, matchKeys],
        )
      : Promise.resolve({ rows: [] as LineupEntryScoutRow[] }),
    loadScouts(client, { orgId: org.orgId, eventKey, userId: input.userId }),
    loadScoutRoleCoverage(client, org.orgId, eventKey),
    input.priorityTeamKeys !== undefined && input.priorityTeamKeys !== null
      ? Promise.resolve(watchlistTeamKeys(input.priorityTeamKeys.map((teamKey) => ({ teamKey }))))
      : loadWatchlistTeamKeys(client, org.orgId),
    client.query<{ eventName: string | null }>(
      `SELECT name AS "eventName" FROM events_ref WHERE event_key = $1::text`,
      [eventKey],
    ),
  ]);

  const slots = orderCoverageByWatchlist(
    buildCoverageGapBoard(
      buildLineupCoverageSlots({
        matches: matches.rows,
        assignments: assignments.rows,
        entryScouts: entryScouts.rows,
      }),
    ),
    watchlistKeys,
  );
  const summary = summarizeCoverageGaps(slots);
  const playedMatchKeys = matches.rows.filter((row) => row.played === true).map((row) => row.matchKey);
  const scope = summarizeCoverageScope(slots, new Set(playedMatchKeys));
  // The live window opens on the next match still to be played. Opening on the
  // first gap put it on Qual 1 at an event 30 matches in, where every gap is
  // already history.
  const nextUpcoming = matches.rows.find((row) => row.played !== true)?.matchKey ?? null;
  const focusKey = input.matchKey || nextUpcoming || defaultLineupFocusMatchKey(slots);

  const live = focusLiveCoverage(slots, {
    matchKey: focusKey,
    windowSize: input.windowSize ?? 4,
  });

  return {
    status: "live",
    orgId: org.orgId,
    teamNumber: org.teamNumber,
    eventKey,
    eventName: eventNameRow.rows[0]?.eventName ?? null,
    generatedAt: new Date().toISOString(),
    qualsOnly,
    canAssign: canWriteAssignments(org.role),
    summary,
    live,
    slots,
    playedMatchKeys,
    scope,
    scouts,
    schemaRoles,
  };
}

// ------------------------------------------------------------------ writes
//
// scout_assignments (migration 0003) grants vantage_app SELECT/INSERT/UPDATE only — there is no
// DELETE grant, and an append-only migration is not warranted just to unassign, so "swap" moves
// an existing row to a different member instead of deleting it. Assign is idempotent through the
// table's own UNIQUE (org_id, user_id, match_key, team_key).

export type AssignCoverageInput = {
  orgId: string;
  eventKey: string;
  matchKey: string;
  teamKey: string;
  userId: string;
  role?: string | null;
};

/** Idempotent: re-assigning the same scout to the same slot is a no-op, not a duplicate row. */
export async function assignCoverageSlot(
  client: PoolClient,
  input: AssignCoverageInput,
): Promise<{ inserted: boolean }> {
  const result = await client.query(
    `INSERT INTO scout_assignments (org_id, event_key, user_id, match_key, team_key, role)
     VALUES ($1::uuid, $2::text, $3::uuid, $4::text, $5::text, COALESCE($6::text, 'primary'))
     ON CONFLICT (org_id, user_id, match_key, team_key) DO NOTHING`,
    [input.orgId, input.eventKey, input.userId, input.matchKey, input.teamKey, input.role ?? null],
  );
  return { inserted: (result.rowCount ?? 0) > 0 };
}

/**
 * Move one slot from one member to another. Concurrency-safe: the UPDATE is scoped to the
 * (org, match, team, from-user) tuple and refuses to collide with an existing row for the
 * target member, so a second device that already moved the row updates zero rows and gets an
 * explicit "already moved" answer instead of silently winning.
 */
export async function swapCoverageSlot(
  client: PoolClient,
  input: {
    orgId: string;
    matchKey: string;
    teamKey: string;
    fromUserId: string;
    toUserId: string;
  },
): Promise<{ moved: boolean }> {
  if (input.fromUserId === input.toUserId) return { moved: false };
  const result = await client.query(
    `UPDATE scout_assignments
        SET user_id = $5::uuid
      WHERE org_id = $1::uuid AND match_key = $2::text AND team_key = $3::text
        AND user_id = $4::uuid
        AND NOT EXISTS (
          SELECT 1 FROM scout_assignments other
           WHERE other.org_id = $1::uuid AND other.match_key = $2::text
             AND other.team_key = $3::text AND other.user_id = $5::uuid
        )`,
    [input.orgId, input.matchKey, input.teamKey, input.fromUserId, input.toUserId],
  );
  return { moved: (result.rowCount ?? 0) > 0 };
}

export type AutoAssignPlanSlot = {
  matchKey: string;
  teamKey: string;
  status: CoverageGapSlot["status"];
  assignmentCount: number;
  matchNumber: number;
  compLevel: string;
};

export type AutoAssignPlanEntry = {
  matchKey: string;
  teamKey: string;
  userId: string;
};

/**
 * Pure round-robin planner for "auto-assign the open gaps".
 *
 * Only slots that are genuinely uncovered AND unassigned get a scout: a slot someone already
 * holds is never reassigned, and a slot with an entry is already covered. Load starts from each
 * member's existing assignment count at this event so the lightest-loaded scout goes first,
 * which makes the plan deterministic for a given input and safe to re-run — after the inserts
 * land, the same call produces an empty plan.
 */
export function planAutoAssignments(input: {
  slots: AutoAssignPlanSlot[];
  scouts: Array<{ userId: string; assignedCount: number }>;
  limit?: number;
  /** Optional watchlist keys — watched threats are assigned before later schedule slots. */
  priorityTeamKeys?: readonly string[];
  /**
   * Matches already played. Their robots can no longer be scouted live, so
   * handing them out only piles finished matches onto each scout's list.
   */
  playedMatchKeys?: ReadonlySet<string> | readonly string[];
  /**
   * True when this member may not take this slot: on drive team for the match,
   * or already holding another robot in it (see assignment-conflicts.ts). The
   * planner also never puts one member on two robots of the same match itself.
   */
  isBlocked?: (userId: string, slot: { matchKey: string; teamKey: string }) => boolean;
}): AutoAssignPlanEntry[] {
  const scouts = input.scouts.map((scout) => ({
    userId: scout.userId,
    load: Number(scout.assignedCount) || 0,
  }));
  if (!scouts.length) return [];

  const priorityTeamKeys = input.priorityTeamKeys ?? [];
  const played = new Set(input.playedMatchKeys ?? []);
  const open = input.slots
    .filter((slot) => slot.status === "unscouted" && slot.assignmentCount === 0 && !played.has(slot.matchKey))
    .slice()
    .sort(
      (a, b) =>
        compareCoverageByWatchlist(a, b, priorityTeamKeys) ||
        (a.compLevel === "qm" ? 0 : 1) - (b.compLevel === "qm" ? 0 : 1) ||
        a.matchNumber - b.matchNumber ||
        a.teamKey.localeCompare(b.teamKey),
    );

  const limit = Math.max(0, Math.trunc(input.limit ?? open.length));
  const plan: AutoAssignPlanEntry[] = [];
  const plannedInMatch = new Map<string, Set<string>>();
  for (const slot of open.slice(0, limit)) {
    scouts.sort((a, b) => a.load - b.load || a.userId.localeCompare(b.userId));
    const taken = plannedInMatch.get(slot.matchKey);
    const next = scouts.find(
      (scout) => !taken?.has(scout.userId) && !input.isBlocked?.(scout.userId, slot),
    );
    // Nobody free for this robot — leave the gap visible rather than double-book.
    if (!next) continue;
    next.load += 1;
    if (taken) taken.add(next.userId);
    else plannedInMatch.set(slot.matchKey, new Set([next.userId]));
    plan.push({ matchKey: slot.matchKey, teamKey: slot.teamKey, userId: next.userId });
  }
  return plan;
}

/** Apply an auto-assign plan; every insert is idempotent, so a retry cannot double-book. */
export async function applyAutoAssignments(
  client: PoolClient,
  input: { orgId: string; eventKey: string; plan: AutoAssignPlanEntry[] },
): Promise<{ assigned: number }> {
  let assigned = 0;
  for (const entry of input.plan) {
    const { inserted } = await assignCoverageSlot(client, {
      orgId: input.orgId,
      eventKey: input.eventKey,
      matchKey: entry.matchKey,
      teamKey: entry.teamKey,
      userId: entry.userId,
    });
    if (inserted) assigned += 1;
  }
  return { assigned };
}
