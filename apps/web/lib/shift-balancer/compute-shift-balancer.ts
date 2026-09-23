import type { PoolClient } from "@neondatabase/serverless";
import { strategyCanSync } from "../strategy/strategy-related";
import {
  DEFAULT_STATIONS,
  generateRotation,
  overlayScheduleOnRotation,
  publishableAssignments,
  rotationConstraintsFromSlots,
  scheduleSlotsFromQuals,
  summarizePlan,
} from ".";
import { BACKUP_ROLE } from "../scouting/assignment-accountability";
import { assignmentConflict, isOnDriveTeamForMatch, withAssignment } from "../scouting/assignment-conflicts";
import { loadAssignmentConflictContext } from "../scouting/assignment-conflicts-load";
import type { PublishPreview, ShiftBalancerAssignment } from ".";
import type { ShiftBalancerPlan, ShiftBalancerScout, ShiftBalancerSummary } from "./types";

export type ShiftBalancerSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export type ShiftBalancerView =
  | {
      status: "setup_required";
      message: string;
      steps: ShiftBalancerSetupStep[];
      orgId: string | null;
    }
  | {
      status: "live";
      orgId: string;
      teamNumber: number | null;
      eventKey: string | null;
      eventName: string | null;
      qualMatchCount: number;
      scouts: ShiftBalancerScout[];
      /** Team members a scout row can be linked to, so a plan can reach them. */
      members: Array<{ id: string; name: string }>;
      plans: ShiftBalancerPlan[];
      latestSummary: ShiftBalancerSummary | null;
      /** True when this member may write the published scout schedule. */
      canPublish: boolean;
      computedAt: string;
    };

type ScoutRow = {
  id: string;
  name: string;
  active: boolean;
  userId: string | null;
};

type PlanRow = {
  id: string;
  label: string;
  matchCount: number;
  stations: string[];
  maxConsecutiveMatches: number;
  assignments: unknown;
  createdAt: string;
};

function mapScout(row: ScoutRow): ShiftBalancerScout {
  return { id: row.id, name: row.name, active: row.active, userId: row.userId ?? null };
}

function mapPlan(row: PlanRow): ShiftBalancerPlan {
  const assignments = Array.isArray(row.assignments)
    ? (row.assignments as ShiftBalancerPlan["assignments"])
    : [];
  return {
    id: row.id,
    label: row.label,
    matchCount: Number(row.matchCount) || 0,
    stations: Array.isArray(row.stations) ? row.stations : DEFAULT_STATIONS,
    maxConsecutiveMatches: Number(row.maxConsecutiveMatches) || 1,
    assignments,
    createdAt: row.createdAt,
  };
}

async function resolveOrg(
  client: PoolClient,
  userId: string,
  requestedOrg: string | null,
): Promise<{ orgId: string; teamNumber: number | null; role: string | null } | null> {
  const membership = await client.query<{ orgId: string; teamNumber: number | null; role: string | null }>(
    `SELECT m.org_id AS "orgId", o.team_number AS "teamNumber", m.role AS role
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

export async function computeShiftBalancerView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null },
): Promise<ShiftBalancerView> {
  const org = await resolveOrg(client, input.userId, input.requestedOrg);

  if (!org) {
    return {
      status: "setup_required",
      message: "Choose your team to build scout shift rotations.",
      steps: [
        { id: "workspace", label: "Choose your team", detail: "Pick which FRC team you are working as.", href: "/workspace" },
      ],
      orgId: null,
    };
  }

  const [scoutResult, planResult, eventResult, qualResult, memberResult] = await Promise.all([
    client.query<ScoutRow>(
      `SELECT id, name, active, user_id AS "userId"
       FROM shift_balancer_scouts
       WHERE org_id = $1
       ORDER BY name`,
      [org.orgId],
    ),
    client.query<PlanRow>(
      `SELECT id, label, match_count AS "matchCount", stations,
              max_consecutive_matches AS "maxConsecutiveMatches",
              assignments, created_at::text AS "createdAt"
       FROM shift_balancer_plans
       WHERE org_id = $1
       ORDER BY created_at DESC
       LIMIT 20`,
      [org.orgId],
    ),
    client.query<{ eventKey: string | null; eventName: string | null }>(
      `SELECT c.active_event_key AS "eventKey", e.name AS "eventName"
       FROM org_active_context c
       LEFT JOIN events_ref e ON e.event_key = c.active_event_key
       WHERE c.org_id = $1`,
      [org.orgId],
    ),
    client.query<{ qualCount: number }>(
      `SELECT count(*)::int AS "qualCount"
       FROM matches_ref
       WHERE event_key = (SELECT active_event_key FROM org_active_context WHERE org_id = $1)
         AND comp_level = 'qm'`,
      [org.orgId],
    ),
    client.query<{ id: string; name: string | null; email: string }>(
      `SELECT u.id, p.display_name AS name, u.email
       FROM memberships m
       JOIN users u ON u.id = m.user_id
       LEFT JOIN profiles p ON p.user_id = u.id
       WHERE m.org_id = $1::uuid
       ORDER BY COALESCE(p.display_name, u.email)`,
      [org.orgId],
    ),
  ]);

  const scouts = scoutResult.rows.map(mapScout);
  const plans = planResult.rows.map(mapPlan);
  const latestPlan = plans[0] ?? null;
  const latestSummary = latestPlan
    ? summarizePlan({
        scouts,
        matchCount: latestPlan.matchCount,
        stations: latestPlan.stations,
        assignments: latestPlan.assignments,
      })
    : null;

  return {
    status: "live",
    orgId: org.orgId,
    teamNumber: org.teamNumber,
    eventKey: eventResult.rows[0]?.eventKey ?? null,
    eventName: eventResult.rows[0]?.eventName ?? null,
    qualMatchCount: Number(qualResult.rows[0]?.qualCount) || 0,
    scouts,
    // Email is the fallback label, not a second field: a member who has not set
    // a display name still has to be pickable.
    members: memberResult.rows.map((row) => ({ id: row.id, name: row.name || row.email })),
    plans,
    latestSummary,
    canPublish: strategyCanSync(org.role),
    computedAt: new Date().toISOString(),
  };
}

// ---- write helpers (run inside the caller's withRls transaction) ----

export async function addScout(
  client: PoolClient,
  input: { orgId: string; userId: string; name: string },
): Promise<void> {
  await client.query(
    `INSERT INTO shift_balancer_scouts (org_id, name, created_by) VALUES ($1,$2,$3)`,
    [input.orgId, input.name, input.userId],
  );
}

export async function setScoutActive(
  client: PoolClient,
  input: { orgId: string; scoutId: string; active: boolean },
): Promise<void> {
  await client.query(`UPDATE shift_balancer_scouts SET active = $1 WHERE id = $2 AND org_id = $3`, [
    input.active,
    input.scoutId,
    input.orgId,
  ]);
}

/**
 * Point a scout row at the team member it actually is, or clear the link.
 *
 * Guarded by a membership check rather than trusting the id in the request: the
 * caller could otherwise link a shift to a user in another team, and every
 * surface that reads scout_assignments would then show that person a duty.
 */
export async function linkScoutToMember(
  client: PoolClient,
  input: { orgId: string; scoutId: string; memberId: string | null },
): Promise<void> {
  if (input.memberId) {
    const member = await client.query(
      `SELECT 1 FROM memberships WHERE org_id = $1::uuid AND user_id = $2::uuid LIMIT 1`,
      [input.orgId, input.memberId],
    );
    if (member.rowCount === 0) throw new Error("That person is not on this team");
  }
  await client.query(
    `UPDATE shift_balancer_scouts SET user_id = $1::uuid WHERE id = $2::uuid AND org_id = $3::uuid`,
    [input.memberId, input.scoutId, input.orgId],
  );
}

/**
 * Write a saved plan into scout_assignments, which is what the schedule, the
 * briefing, Event Day command and the dashboard already read.
 *
 * Idempotent by the table's own unique key, so publishing the same plan twice
 * updates the station and time rather than erroring or duplicating a duty.
 */
export async function publishPlan(
  client: PoolClient,
  input: { orgId: string; planId: string },
): Promise<PublishPreview> {
  const plan = await client.query<{ assignments: unknown }>(
    `SELECT assignments FROM shift_balancer_plans WHERE id = $1::uuid AND org_id = $2::uuid`,
    [input.planId, input.orgId],
  );
  if (plan.rowCount === 0) throw new Error("That plan no longer exists");

  const scouts = await client.query<{ id: string; userId: string | null }>(
    `SELECT id, user_id AS "userId" FROM shift_balancer_scouts WHERE org_id = $1::uuid`,
    [input.orgId],
  );
  const event = await client.query<{ eventKey: string | null }>(
    `SELECT active_event_key AS "eventKey" FROM org_active_context WHERE org_id = $1::uuid`,
    [input.orgId],
  );
  const eventKey = event.rows[0]?.eventKey ?? null;
  if (!eventKey) throw new Error("Set the active event before publishing");

  const raw = plan.rows[0]?.assignments;
  const preview = publishableAssignments(
    Array.isArray(raw) ? (raw as ShiftBalancerAssignment[]) : [],
    scouts.rows,
  );

  // Refuse what the generator could not see: drive team changed since the plan
  // was built, or the lineup already put this member on another robot in the
  // same match. Skipped rows are counted, never silently dropped.
  let conflicts = await loadAssignmentConflictContext(client, { orgId: input.orgId, eventKey });
  const written: typeof preview.rows = [];
  let skippedConflict = 0;
  for (const row of preview.rows) {
    if (assignmentConflict(conflicts, row)) {
      skippedConflict += 1;
      continue;
    }
    written.push(row);
    conflicts = withAssignment(conflicts, { ...row, role: row.role ?? row.station });
  }

  for (const row of written) {
    await client.query(
      `INSERT INTO scout_assignments (org_id, event_key, user_id, match_key, team_key, role, starts_at)
       VALUES ($1::uuid, $2::text, $3::uuid, $4::text, $5::text, $6::text, $7::timestamptz)
       ON CONFLICT (org_id, user_id, match_key, team_key)
       DO UPDATE SET role = EXCLUDED.role, starts_at = EXCLUDED.starts_at`,
      [input.orgId, eventKey, row.userId, row.matchKey, row.teamKey, row.role === "backup" ? BACKUP_ROLE : row.station, row.startsAt],
    );
  }
  return skippedConflict ? { ...preview, rows: written, skippedConflict } : preview;
}

export async function removeScout(
  client: PoolClient,
  input: { orgId: string; scoutId: string },
): Promise<void> {
  await client.query(`DELETE FROM shift_balancer_scouts WHERE id = $1 AND org_id = $2`, [
    input.scoutId,
    input.orgId,
  ]);
}

export async function generatePlan(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    label: string;
    matchCount: number;
    stations: string[];
    maxConsecutiveMatches: number;
    useEventSchedule?: boolean;
    /** Add a backup scout on every partner and opponent robot in our own matches. */
    backups?: boolean;
  },
): Promise<void> {
  const scoutResult = await client.query<ScoutRow>(
    `SELECT id, name, active, user_id AS "userId" FROM shift_balancer_scouts WHERE org_id = $1 AND active = true ORDER BY name`,
    [input.orgId],
  );
  const scouts = scoutResult.rows.map(mapScout);
  const stations = input.stations.length > 0 ? input.stations : DEFAULT_STATIONS;

  let matchCount = input.matchCount;
  let assignments: ReturnType<typeof generateRotation>;

  if (input.useEventSchedule) {
    const eventRow = await client.query<{ eventKey: string }>(
      `SELECT active_event_key AS "eventKey"
       FROM org_active_context
       WHERE org_id = $1 AND active_event_key IS NOT NULL`,
      [input.orgId],
    );
    const eventKey = eventRow.rows[0]?.eventKey ?? null;
    if (!eventKey) {
      throw new Error("Set an active event on Command before generating from the event schedule.");
    }
    const matchRows = await client.query<{
      matchKey: string;
      matchNumber: number;
      redAlliance: unknown;
      blueAlliance: unknown;
      scheduledAt: string | null;
    }>(
      `SELECT match_key AS "matchKey", match_number AS "matchNumber",
              red_alliance AS "redAlliance", blue_alliance AS "blueAlliance",
              COALESCE(predicted_time, event_time)::text AS "scheduledAt"
       FROM matches_ref
       WHERE event_key = $1 AND comp_level = 'qm'
       ORDER BY match_number`,
      [eventKey],
    );
    const slots = scheduleSlotsFromQuals(matchRows.rows);
    const qualMatches = new Set(slots.map((slot) => slot.matchNumber)).size;
    if (qualMatches === 0) {
      throw new Error("No qualification schedule cached for the active event. Sync Team Data or pick an event on Event day.");
    }
    matchCount = qualMatches;
    // Drive team never scouts a match our robot is in; backups only where asked.
    const conflictContext = await loadAssignmentConflictContext(client, { orgId: input.orgId, eventKey });
    const constraints = rotationConstraintsFromSlots({
      slots,
      stations,
      ourTeamKey: conflictContext.ourTeamKey,
      backups: input.backups === true,
      blockedScouts: (matchKey) =>
        scouts
          .filter((scout) => scout.userId && isOnDriveTeamForMatch(conflictContext, scout.userId, matchKey))
          .map((scout) => scout.id),
    });
    assignments = overlayScheduleOnRotation(
      generateRotation({
        scouts,
        matchCount,
        stations,
        maxConsecutiveMatches: input.maxConsecutiveMatches,
        unavailable: constraints.unavailable,
        backupStations: constraints.backupStations,
      }),
      slots,
    );
  } else {
    assignments = generateRotation({
      scouts,
      matchCount,
      stations,
      maxConsecutiveMatches: input.maxConsecutiveMatches,
    });
  }

  await client.query(
    `INSERT INTO shift_balancer_plans
       (org_id, label, match_count, stations, max_consecutive_matches, assignments, generated_by)
     VALUES ($1,$2,$3,$4::text[],$5,$6::jsonb,$7)`,
    [
      input.orgId,
      input.label,
      matchCount,
      stations,
      input.maxConsecutiveMatches,
      JSON.stringify(assignments),
      input.userId,
    ],
  );
}

export async function deletePlan(
  client: PoolClient,
  input: { orgId: string; planId: string },
): Promise<void> {
  await client.query(`DELETE FROM shift_balancer_plans WHERE id = $1 AND org_id = $2`, [
    input.planId,
    input.orgId,
  ]);
}
