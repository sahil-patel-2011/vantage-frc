import type { PoolClient } from "@neondatabase/serverless";
import { loadOnDutyForMyDay, type MyDayDutyCue } from "./duties";
import {
  buildMyDayMatches,
  freshnessLabel,
  type MyDayContext,
  type MyDayView,
} from "./my-day";
import type { ScheduleMatch } from "./schedule-board";

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
      message: "Select a team workspace to open My Day.",
      steps: [
        {
          id: "workspace",
          label: "Select workspace",
          detail: "Choose your team organization",
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
      message: "Select an active event to load your match queue.",
      steps: [
        {
          id: "event",
          label: "Select active event",
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
      message: "Set your organization team number so we can filter your matches.",
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
  const syncedAt =
    matchesRes.rows
      .map((r) => r.syncedAt)
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1) ?? null;

  const logistics = await loadMyDayLogistics(client, {
    orgId: row.orgId,
    userId: input.userId,
    teamRole: row.teamRole,
    eventKey: row.eventKey,
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
      matchCount: schedule.length,
      ourMatchCount: built.matches.length,
    },
    logistics,
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

