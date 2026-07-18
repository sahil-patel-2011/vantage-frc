import type { PoolClient } from "@neondatabase/serverless";
import { emitPreferredNotification } from "@vantage/core";
import {
  rankScoutsForStrategySeats,
  selectPickInfluencingEntries,
} from "@vantage/scouting/trust";

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Attribute scout rows that fed a saved pick list and tell those scouts where the data went. */
export async function recordPickListInfluence(
  client: PoolClient,
  input: {
    orgId: string;
    eventKey: string;
    pickListId: string;
    listName: string;
    entries: Array<{ teamKey: string; rank: number; tier?: string | null }>;
    recordedBy: string;
  },
): Promise<{ attributed: number; notified: number }> {
  const teamKeys = [...new Set(input.entries.map((entry) => entry.teamKey).filter(Boolean))];
  if (!teamKeys.length) return { attributed: 0, notified: 0 };

  const scoutEntries = await client.query<{
    id: string;
    teamKey: string;
    scoutUserId: string;
    confidence: string;
    updatedAt: string;
  }>(
    `SELECT id, team_key AS "teamKey", scout_user_id AS "scoutUserId",
            confidence::text AS confidence, updated_at::text AS "updatedAt"
     FROM match_scout_entries
     WHERE org_id = $1::uuid
       AND event_key = $2
       AND team_key = ANY($3::text[])
     ORDER BY updated_at DESC
     LIMIT 1200`,
    [input.orgId, input.eventKey, teamKeys],
  );

  const attributions = selectPickInfluencingEntries({
    pickTeams: input.entries,
    listName: input.listName,
    entries: scoutEntries.rows.map((row) => ({
      id: row.id,
      teamKey: row.teamKey,
      scoutUserId: row.scoutUserId,
      confidence:
        row.confidence === "high" || row.confidence === "low" ? row.confidence : "normal",
      updatedAt: row.updatedAt,
    })),
  });

  const notified = new Set<string>();
  for (const attribution of attributions) {
    await client.query(
      `INSERT INTO scout_pick_influence(org_id, event_key, pick_list_id, team_key, entry_id, reason, recorded_by)
       VALUES ($1::uuid, $2, $3::uuid, $4, $5::uuid, $6, $7::uuid)
       ON CONFLICT (org_id, event_key, team_key, entry_id)
       DO UPDATE SET reason = excluded.reason,
                     pick_list_id = excluded.pick_list_id,
                     recorded_by = excluded.recorded_by,
                     recorded_at = now()`,
      [
        input.orgId,
        input.eventKey,
        input.pickListId,
        attribution.teamKey,
        attribution.entryId,
        attribution.reason,
        input.recordedBy,
      ],
    );
    if (notified.has(attribution.scoutUserId)) continue;
    notified.add(attribution.scoutUserId);
    await emitPreferredNotification(client, {
      userId: attribution.scoutUserId,
      orgId: input.orgId,
      type: "scout_pick_influence",
      payload: {
        title: "Where your scouting went",
        eventKey: input.eventKey,
        pickListId: input.pickListId,
        teamKey: attribution.teamKey,
        href: `/scouting?orgId=${encodeURIComponent(input.orgId)}&tab=trust`,
        message: attribution.reason,
      },
    });
  }

  return { attributed: attributions.length, notified: notified.size };
}

/** Seat the most accurate TBA-validated scouts into today's pick-desk conversation. */
export async function seatTopAccurateScouts(
  client: PoolClient,
  input: {
    orgId: string;
    eventKey: string;
    assignedBy: string;
    seatCount?: number;
    meetingOn?: string;
  },
): Promise<{ seated: Array<{ userId: string; reason: string }> }> {
  const meetingOn =
    input.meetingOn && /^\d{4}-\d{2}-\d{2}$/.test(input.meetingOn) ? input.meetingOn : todayUtc();

  const leaderboard = await client.query<{
    userId: string;
    entries: number;
    checks: number;
    matches: number;
  }>(
    `SELECT e.scout_user_id AS "userId",
            count(DISTINCT e.id)::int AS entries,
            count(v.id) FILTER (WHERE v.status IN ('match','conflict'))::int AS checks,
            count(v.id) FILTER (WHERE v.status = 'match')::int AS matches
     FROM match_scout_entries e
     LEFT JOIN scout_entry_validations v ON v.entry_id = e.id
     WHERE e.org_id = $1::uuid AND e.event_key = $2
     GROUP BY e.scout_user_id`,
    [input.orgId, input.eventKey],
  );

  const ranked = rankScoutsForStrategySeats({
    scouts: leaderboard.rows,
    seatCount: input.seatCount,
    minChecks: 1,
  });

  for (const seat of ranked) {
    await client.query(
      `INSERT INTO scout_strategy_seats(org_id, event_key, user_id, meeting_on, reason, assigned_by)
       VALUES ($1::uuid, $2, $3::uuid, $4::date, $5, $6::uuid)
       ON CONFLICT (org_id, event_key, user_id, meeting_on)
       DO UPDATE SET reason = excluded.reason, assigned_by = excluded.assigned_by`,
      [input.orgId, input.eventKey, seat.userId, meetingOn, seat.reason, input.assignedBy],
    );
    await emitPreferredNotification(client, {
      userId: seat.userId,
      orgId: input.orgId,
      type: "scout_strategy_seat",
      payload: {
        title: "Strategy meeting seat",
        eventKey: input.eventKey,
        meetingOn,
        href: `/strategy?orgId=${encodeURIComponent(input.orgId)}&tab=picks`,
        message: `You earned a strategy seat for ${meetingOn}: ${seat.reason}`,
      },
    });
  }

  return { seated: ranked.map((seat) => ({ userId: seat.userId, reason: seat.reason })) };
}
