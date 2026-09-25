import type { PoolClient } from "@neondatabase/serverless";
import { loadOnDutyForMyDay, type MyDayDutyCue } from "./duties";
import {
  buildMyDayMatches,
  freshnessLabel,
  type MyDayContext,
  type MyDayView,
} from "./my-day";
import type { ScheduleMatch } from "./schedule-board";
import { matchLabelFromKey } from "./matches/no-next-match";
import { withSavepoint } from "@vantage/db";

export type MyDayLodging = {
  hotelName: string;
  hotelAddress: string;
  hotelPhone: string;
  roomLabel: string;
  checkInAt: string | null;
  checkOutAt: string | null;
  tripTitle: string;
  tripId: string;
} | null;

export type MyDayTravelStop = {
  id: string;
  kind: string;
  title: string;
  startsAt: string;
  endsAt: string | null;
  location: string;
  meetingPoint: string;
  notes: string;
  tripId: string;
  tripTitle: string;
};

export type MyDayOnDuty = MyDayDutyCue;

export type MyDayLogisticsBundle = {
  lodging: MyDayLodging;
  nextTravel: MyDayTravelStop | null;
  onDuty: MyDayOnDuty | null;
  checklistPercent: number | null;
};

type AllianceJson = { teamKeys?: unknown; score?: unknown } | null;

function teamKeys(alliance: AllianceJson): string[] {
  const keys = alliance?.teamKeys;
  if (!Array.isArray(keys)) return [];
  return keys.map((key) => String(key));
}

function allianceScore(alliance: AllianceJson): number | null {
  const score = alliance?.score;
  return score == null ? null : Number(score);
}

function pickNextTravel(stops: MyDayTravelStop[], now = new Date()): MyDayTravelStop | null {
  const t = now.getTime();
  return (
    [...stops]
      .filter((stop) => {
        const start = new Date(stop.startsAt).getTime();
        return Number.isFinite(start) && start >= t - 30 * 60_000;
      })
      .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime())[0] ?? null
  );
}

/** Lodging / travel / on-duty cues for Command + My Day. Missing tables â†’ empty cues. */
export async function loadMyDayLogistics(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    teamRole: string | null;
    eventKey: string | null;
    now?: Date;
  },
): Promise<MyDayLogisticsBundle> {
  const empty: MyDayLogisticsBundle = {
    lodging: null,
    nextTravel: null,
    onDuty: null,
    checklistPercent: null,
  };

  try {
    const rooms = await client.query<{
      hotelName: string;
      hotelAddress: string;
      hotelPhone: string;
      roomLabel: string;
      checkInAt: string | null;
      checkOutAt: string | null;
      tripTitle: string;
      tripId: string;
    }>(
      `SELECT h.name AS "hotelName", h.address AS "hotelAddress", h.phone AS "hotelPhone",
              r.room_label AS "roomLabel",
              h.check_in_at::text AS "checkInAt", h.check_out_at::text AS "checkOutAt",
              t.title AS "tripTitle", t.id::text AS "tripId"
       FROM logistics_room_assignments r
       JOIN logistics_hotels h ON h.id = r.hotel_id
       JOIN logistics_trips t ON t.id = h.trip_id
       WHERE r.org_id = $1::uuid AND r.occupant_user_id = $2::uuid
       ORDER BY h.check_in_at DESC NULLS LAST
       LIMIT 1`,
      [input.orgId, input.userId],
    );
    const lodging = rooms.rows[0]
      ? {
          hotelName: rooms.rows[0].hotelName,
          hotelAddress: rooms.rows[0].hotelAddress,
          hotelPhone: rooms.rows[0].hotelPhone,
          roomLabel: rooms.rows[0].roomLabel,
          checkInAt: rooms.rows[0].checkInAt,
          checkOutAt: rooms.rows[0].checkOutAt,
          tripTitle: rooms.rows[0].tripTitle,
          tripId: rooms.rows[0].tripId,
        }
      : null;

    let nextTravel: MyDayTravelStop | null = null;
    try {
      const legs = await client.query<MyDayTravelStop>(
        `SELECT l.id::text AS id, l.kind, l.title,
                l.starts_at::text AS "startsAt", l.ends_at::text AS "endsAt",
                l.location, l.meeting_point AS "meetingPoint", l.notes,
                l.trip_id::text AS "tripId", t.title AS "tripTitle"
         FROM logistics_travel_legs l
         JOIN logistics_trips t ON t.id = l.trip_id
         WHERE l.org_id = $1::uuid
           AND ($2::text IS NULL OR t.event_key = $2 OR t.event_key IS NULL)
         ORDER BY l.starts_at ASC
         LIMIT 40`,
        [input.orgId, input.eventKey],
      );
      nextTravel = pickNextTravel(legs.rows);
    } catch {
      nextTravel = null;
    }

    const onDuty = await loadOnDutyForMyDay(client, {
      orgId: input.orgId,
      userId: input.userId,
      now: input.now,
    });

    let checklistPercent: number | null = null;
    try {
      const lens =
        input.teamRole === "mentor" || input.teamRole === "coach" ? "mentor" : "student";
      const counts = await client.query<{ total: string; done: string }>(
        `SELECT
           (SELECT count(*)::text FROM logistics_checklist_items i
            WHERE i.org_id = $1::uuid AND i.audience IN ('all', $3)) AS total,
           (SELECT count(*)::text FROM logistics_checklist_items i
            JOIN logistics_checklist_checks c ON c.item_id = i.id AND c.user_id = $2::uuid
            WHERE i.org_id = $1::uuid AND i.audience IN ('all', $3)) AS done`,
        [input.orgId, input.userId, lens],
      );
      const total = Number(counts.rows[0]?.total ?? 0);
      const done = Number(counts.rows[0]?.done ?? 0);
      checklistPercent = total > 0 ? Math.round((done / total) * 100) : null;
    } catch {
      checklistPercent = null;
    }

    return { lodging, nextTravel, onDuty, checklistPercent };
  } catch {
    return empty;
  }
}

export async function loadMyDayView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null },
): Promise<MyDayView> {
  const membership = await client.query<{
    orgId: string;
    orgName: string;
    teamNumber: number | null;
    role: string;
    teamRole: string | null;
    eventKey: string | null;
    eventName: string | null;
  }>(
    `SELECT m.org_id AS "orgId", o.name AS "orgName", o.team_number AS "teamNumber", m.role,
            p.team_role AS "teamRole",
            c.active_event_key AS "eventKey", e.name AS "eventName"
     FROM memberships m
     JOIN organizations o ON o.id = m.org_id
     LEFT JOIN profiles p ON p.user_id = m.user_id
     LEFT JOIN org_active_context c ON c.org_id = o.id
     LEFT JOIN events_ref e ON e.event_key = c.active_event_key
     WHERE m.user_id = $1 AND ($2::uuid IS NULL OR m.org_id = $2::uuid)
     ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, o.team_number
     LIMIT 1`,
    [input.userId, input.requestedOrg],
  );

  const row = membership.rows[0];
  const emptyContext: MyDayContext = {
    orgId: null,
    orgName: null,
    teamNumber: null,
    role: null,
    eventKey: null,
    eventName: null,
  };

  if (!row) {
    return {
      status: "setup_required",
      context: emptyContext,
      message: "Choose your team to open My Day.",
      steps: [
        {
          id: "workspace",
          label: "Choose your team",
          detail: "Pick which FRC team you are working as.",
          href: "/workspace",
        },
      ],
    };
  }

  const context: MyDayContext = {
    orgId: row.orgId,
    orgName: row.orgName,
    teamNumber: row.teamNumber,
    role: row.role,
    eventKey: row.eventKey,
    eventName: row.eventName,
  };
  const orgQ = `?orgId=${encodeURIComponent(row.orgId)}`;

  if (!row.eventKey) {
    return {
      status: "setup_required",
      context,
      message: "Set your active event to load your match queue.",
      steps: [
        {
          id: "event",
          label: "Set active event",
          detail: "Set the competition you are at today",
          href: `/command${orgQ}`,
        },
      ],
    };
  }

  if (!row.teamNumber) {
    return {
      status: "setup_required",
      context,
      message: "Set your team's number so we can filter your matches.",
      steps: [
        {
          id: "team",
          label: "Confirm team number",
          detail: "Org team number powers next-match filtering",
          href: `/team${orgQ}`,
        },
      ],
    };
  }

  const teamKey = `frc${row.teamNumber}`;
  const matchesRes = await client.query<{
    matchKey: string;
    compLevel: string;
    matchNumber: number;
    scheduledTime: string | null;
    syncedAt: string | null;
    redAlliance: AllianceJson;
    blueAlliance: AllianceJson;
    winningAlliance: string | null;
  }>(
    `SELECT m.match_key AS "matchKey", m.comp_level AS "compLevel", m.match_number AS "matchNumber",
            COALESCE(m.actual_time, m.predicted_time, m.event_time)::text AS "scheduledTime",
            m.synced_at::text AS "syncedAt",
            m.red_alliance AS "redAlliance", m.blue_alliance AS "blueAlliance",
            m.winning_alliance AS "winningAlliance"
     FROM matches_ref m
     WHERE m.event_key = $1
     ORDER BY CASE m.comp_level
                WHEN 'qm' THEN 0 WHEN 'ef' THEN 1 WHEN 'qf' THEN 2
                WHEN 'sf' THEN 3 WHEN 'f' THEN 4 ELSE 5
              END, m.match_number`,
    [row.eventKey],
  );

  const schedule: ScheduleMatch[] = matchesRes.rows.map((entry) => ({
    matchKey: entry.matchKey,
    compLevel: entry.compLevel,
    matchNumber: entry.matchNumber,
    scheduledTime: entry.scheduledTime,
    red: teamKeys(entry.redAlliance),
    blue: teamKeys(entry.blueAlliance),
    redScore: allianceScore(entry.redAlliance),
    blueScore: allianceScore(entry.blueAlliance),
    winningAlliance:
      entry.winningAlliance === "red" || entry.winningAlliance === "blue" ? entry.winningAlliance : null,
    scoutCount: 0,
  }));

  const built = buildMyDayMatches(schedule, { orgId: row.orgId, teamKey });
  // The feed's last good check counts as a sync: an unchanged schedule answers "not modified"
  // and its rows keep their old synced_at.
  // No health to read means: say how old the rows are, never that they are out of date.
  const feed = await withSavepoint(
    client,
    async () => {
      const health = await client.query<{ lastSuccessAt: string | null }>(
        `SELECT last_success_at::text AS "lastSuccessAt" FROM data_source_health WHERE source = 'tba' LIMIT 1`,
      );
      return { known: health.rows.length > 0, checkedAt: health.rows[0]?.lastSuccessAt ?? null };
    },
    { known: false, checkedAt: null as string | null },
  );
  const feedKnown = feed.known;
  const feedCheckedAt = feed.checkedAt;
  const syncedAt =
    [...matchesRes.rows.map((r) => r.syncedAt), feedCheckedAt]
      .filter((value): value is string => Boolean(value))
      .map((value) => ({ value, at: Date.parse(value) }))
      .filter((entry) => Number.isFinite(entry.at))
      .sort((a, b) => a.at - b.at)
      .at(-1)?.value ?? null;

  const logistics = await loadMyDayLogistics(client, {
    orgId: row.orgId,
    userId: input.userId,
    teamRole: row.teamRole,
    eventKey: row.eventKey,
  });

  // The robots this person scouts next: primary duties, not filed yet, not long past. The
  // same rules as Home's "what to do now" card (lib/dashboard/home-widget-loaders.ts).
  const duties = await client.query<{ matchKey: string; teamKey: string; scheduledTime: string | null }>(
    `SELECT /* my-day:scouting */ a.match_key AS "matchKey", a.team_key AS "teamKey",
            coalesce(m.actual_time, m.predicted_time, m.event_time, a.starts_at)::text AS "scheduledTime"
       FROM scout_assignments a
       JOIN matches_ref m ON m.match_key = a.match_key
      WHERE a.org_id = $1::uuid AND a.user_id = $2::uuid AND a.event_key = $3::text
        AND lower(coalesce(a.role, '')) <> 'backup'
        AND coalesce(m.actual_time, m.predicted_time, m.event_time, a.starts_at, now())
            > now() - interval '15 minutes'
        AND NOT EXISTS (
          SELECT 1 FROM match_scout_entries e
           WHERE e.org_id = a.org_id AND e.match_key = a.match_key AND e.team_key = a.team_key
        )
      ORDER BY coalesce(m.actual_time, m.predicted_time, m.event_time, a.starts_at) NULLS LAST, m.match_number
      LIMIT 4`,
    [row.orgId, input.userId, row.eventKey],
  );
  const byKey = new Map(schedule.map((match) => [match.matchKey, match]));
  const scouting = duties.rows.map((duty) => {
    const match = byKey.get(duty.matchKey);
    const redAt = match?.red.indexOf(duty.teamKey) ?? -1;
    const blueAt = match?.blue.indexOf(duty.teamKey) ?? -1;
    return {
      matchKey: duty.matchKey,
      teamKey: duty.teamKey,
      matchLabel: matchLabelFromKey(duty.matchKey),
      station: redAt >= 0 ? `Red ${redAt + 1}` : blueAt >= 0 ? `Blue ${blueAt + 1}` : null,
      scheduledTime: duty.scheduledTime,
    };
  });

  const emptyReason: "no_schedule" | "no_upcoming" | null =
    schedule.length === 0 ? "no_schedule" : built.matches.length === 0 ? "no_upcoming" : null;

  return {
    status: "ready",
    context,
    teamKey,
    next: built.next,
    matches: built.matches,
    freshness: {
      syncedAt,
      label: freshnessLabel(syncedAt),
      feedKnown,
      matchCount: schedule.length,
      ourMatchCount: built.matches.length,
    },
    logistics,
    scouting,
    emptyReason,
    links: {
      command: `/command${orgQ}`,
      schedule: `/schedule${orgQ}`,
      logistics: `/logistics${orgQ}`,
      scouting: `/scouting${orgQ}`,
      checklist: `/match-checklist${orgQ}`,
      calendar: `/team/calendar${orgQ}`,
      knowledge: `/team/knowledge${orgQ}`,
      discord: `/team/discord${orgQ}`,
    },
  };
}

// Re-export view type name used by older call sites.
export type { MyDayView };

