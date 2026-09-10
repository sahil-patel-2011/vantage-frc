import type { PoolClient } from "@neondatabase/serverless";
import { allLessonIds } from "../cad-learn/track";
import type { DashboardWidgetType } from "./catalog";

type WidgetDataStatus = "live" | "empty" | "setup_required";

type StampedWidget = {
  type: DashboardWidgetType;
  status: WidgetDataStatus;
  updatedAt: string;
  message?: string;
  data?: Record<string, unknown>;
};

export type HomeWidgetContext = {
  orgId: string;
  userId: string;
  eventKey: string | null;
  eventName: string | null;
  teamNumber: number | null;
  fundingModel: string | null;
};

type Loaded = {
  status: WidgetDataStatus;
  data?: Record<string, unknown>;
  message?: string;
};

const ISO = `to_char(%s AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`;

function empty(message: string): Loaded {
  return { status: "empty", message };
}

function live(data: Record<string, unknown>, message?: string): Loaded {
  return { status: "live", data, message };
}

function teamKeyOf(teamNumber: number | null): string | null {
  return teamNumber ? `frc${teamNumber}` : null;
}

async function query<T extends Record<string, unknown>>(
  client: PoolClient,
  sql: string,
  params: unknown[],
): Promise<T[]> {
  const result = await client.query<T>(sql, params);
  return result.rows;
}

async function myDay(client: PoolClient, ctx: HomeWidgetContext): Promise<Loaded> {
  const teamKey = teamKeyOf(ctx.teamNumber);
  let matchLabel: string | null = null;
  let matchAt: string | null = null;
  let bumperCue: string | null = null;
  if (ctx.eventKey && teamKey) {
    const matches = await query<{
      matchNumber: number;
      compLevel: string;
      scheduledTime: string | null;
      redAlliance: { teamKeys?: string[] } | null;
      blueAlliance: { teamKeys?: string[] } | null;
    }>(
      client,
      `SELECT /* home-widget:my_day */ match_number AS "matchNumber", comp_level AS "compLevel",
              COALESCE(predicted_time, event_time)::text AS "scheduledTime",
              red_alliance AS "redAlliance", blue_alliance AS "blueAlliance"
         FROM matches_ref
        WHERE event_key = $1
          AND (red_alliance->'teamKeys' ? $2 OR blue_alliance->'teamKeys' ? $2)
          AND COALESCE(actual_time, predicted_time, event_time) > now()
        ORDER BY COALESCE(actual_time, predicted_time, event_time)
        LIMIT 1`,
      [ctx.eventKey, teamKey],
    );
    const row = matches[0];
    if (row) {
      const red = row.redAlliance?.teamKeys ?? [];
      const blue = row.blueAlliance?.teamKeys ?? [];
      const alliance = red.includes(teamKey) ? "red" : blue.includes(teamKey) ? "blue" : null;
      matchLabel = `${row.compLevel} ${row.matchNumber}`;
      matchAt = row.scheduledTime;
      bumperCue =
        alliance === "red" ? "Switch to RED bumpers" : alliance === "blue" ? "Switch to BLUE bumpers" : null;
    }
  }
  const events = await query<{ title: string; startsAt: string }>(
    client,
    `SELECT /* home-widget:my_day-cal */ title,
            ${ISO.replace("%s", "e.starts_at")} AS "startsAt"
       FROM subteam_calendar_events e
      WHERE e.org_id = $1::uuid
        AND e.starts_at >= date_trunc('day', now())
        AND e.starts_at < date_trunc('day', now()) + interval '1 day'
        AND (
          e.subteam_id IS NULL
          OR e.subteam_id IN (
            SELECT subteam_id FROM team_subteam_members
             WHERE org_id = $1::uuid AND user_id = $2::uuid
          )
        )
      ORDER BY e.starts_at ASC
      LIMIT 3`,
    [ctx.orgId, ctx.userId],
  );
  const duties = await query<{ title: string; startsAt: string }>(
    client,
    `SELECT /* home-widget:my_day-duty */ title,
            ${ISO.replace("%s", "starts_at")} AS "startsAt"
       FROM duty_assignments
      WHERE org_id = $1::uuid AND assigned_user_id = $2::uuid AND starts_at >= now()
      ORDER BY starts_at ASC
      LIMIT 2`,
    [ctx.orgId, ctx.userId],
  );
  if (!matchLabel && events.length === 0 && duties.length === 0) {
    return empty("No matches on your day yet. Open My Day after TBA sync.");
  }
  return live({
    href: "/my-day",
    matchLabel,
    matchAt,
    bumperCue,
    events,
    duties,
  });
}

async function learnProgress(client: PoolClient, ctx: HomeWidgetContext): Promise<Loaded> {
  const total = allLessonIds().length;
  const rows = await query<{ completed: string; viewed: string }>(
    client,
    `SELECT /* home-widget:learn_progress */
            count(*) FILTER (WHERE completed_at IS NOT NULL)::text AS completed,
            count(*)::text AS viewed
       FROM cad_learn_progress
      WHERE org_id = $1::uuid AND user_id = $2::uuid`,
    [ctx.orgId, ctx.userId],
  );
  const completed = Number(rows[0]?.completed ?? 0);
  const viewed = Number(rows[0]?.viewed ?? 0);
  if (completed === 0 && viewed === 0) {
    return empty("Start Learn CAD or programming setup to see progress here.");
  }
  return live({
    cadCompleted: completed,
    cadTotal: total,
    cadViewed: viewed,
    href: "/cad-learn",
    programmingHref: "/dev-setup",
  });
}

async function filesRecent(client: PoolClient, ctx: HomeWidgetContext): Promise<Loaded> {
  const files = await query<{ id: string; name: string; updatedAt: string }>(
    client,
    `SELECT /* home-widget:files_recent */ id, name,
            ${ISO.replace("%s", "updated_at")} AS "updatedAt"
       FROM drive_files
      WHERE org_id = $1::uuid AND deleted_at IS NULL AND status = 'ready'
      ORDER BY updated_at DESC
      LIMIT 5`,
    [ctx.orgId],
  );
  if (files.length === 0) return empty("No files opened yet. Open Files to add one.");
  return live({ items: files, href: "/files" });
}

async function teamChat(client: PoolClient, ctx: HomeWidgetContext): Promise<Loaded> {
  const rows = await query<{ unread: string; title: string | null }>(
    client,
    `SELECT /* home-widget:team_chat */ c.title,
            COALESCE((
              SELECT COUNT(*)::text
                FROM org_messages m
                LEFT JOIN org_conversation_participants p
                  ON p.conversation_id = c.id AND p.user_id = $2::uuid
               WHERE m.conversation_id = c.id
                 AND m.deleted_at IS NULL
                 AND m.author_user_id <> $2::uuid
                 AND (p.last_read_at IS NULL OR m.created_at > p.last_read_at)
            ), '0') AS unread
       FROM org_conversations c
      WHERE c.org_id = $1::uuid AND c.kind = 'team'
      ORDER BY unread DESC
      LIMIT 5`,
    [ctx.orgId, ctx.userId],
  );
  const unread = rows.reduce((sum, row) => sum + Number(row.unread ?? 0), 0);
  if (unread === 0) return empty("No unread team chats.");
  return live({
    unread,
    channels: rows.filter((row) => Number(row.unread ?? 0) > 0).map((row) => ({
      title: row.title || "Team",
      unread: Number(row.unread ?? 0),
    })),
    href: "/messages",
  });
}

async function duties(client: PoolClient, ctx: HomeWidgetContext): Promise<Loaded> {
  const rows = await query<{ count: string }>(
    client,
    `SELECT /* home-widget:duties */ count(*)::text AS count
       FROM duty_assignments
      WHERE org_id = $1::uuid AND assigned_user_id IS NULL AND starts_at >= now()`,
    [ctx.orgId],
  );
  const open = Number(rows[0]?.count ?? 0);
  if (open === 0) return empty("Nothing needs assignment tonight.");
  const items = await query<{ id: string; title: string; startsAt: string }>(
    client,
    `SELECT /* home-widget:duties-items */ id, title,
            ${ISO.replace("%s", "starts_at")} AS "startsAt"
       FROM duty_assignments
      WHERE org_id = $1::uuid AND assigned_user_id IS NULL AND starts_at >= now()
      ORDER BY starts_at ASC
      LIMIT 5`,
    [ctx.orgId],
  );
  return live({ open, items, href: "/duties" });
}

async function budgetParts(client: PoolClient, ctx: HomeWidgetContext): Promise<Loaded> {
  const [budget, pending] = await Promise.all([
    query<{ budgetUsd: string | null; spentUsd: string | null }>(
      client,
      `SELECT /* home-widget:budget_parts */
              SUM(p.total_limit_usd)::text AS "budgetUsd",
              (
                SELECT SUM(t.amount_usd)::text
                  FROM finance_transactions t
                 WHERE t.org_id = $1::uuid
                   AND t.counts_in_balance IS TRUE
                   AND t.type = 'expense'
              ) AS "spentUsd"
         FROM finance_budget_plans p
         JOIN finance_categories c ON c.id = p.category_id
        WHERE c.org_id = $1::uuid`,
      [ctx.orgId],
    ),
    query<{ count: string }>(
      client,
      `SELECT /* home-widget:budget_parts-req */ count(*)::text AS count
         FROM purchase_requests
        WHERE org_id = $1::uuid AND status = 'pending'`,
      [ctx.orgId],
    ),
  ]);
  const budgetUsd = budget[0]?.budgetUsd != null ? Number(budget[0].budgetUsd) : null;
  const spentUsd = budget[0]?.spentUsd != null ? Number(budget[0].spentUsd) : null;
  const remainingUsd =
    budgetUsd != null && Number.isFinite(budgetUsd)
      ? budgetUsd - (spentUsd != null && Number.isFinite(spentUsd) ? spentUsd : 0)
      : null;
  const pendingCount = Number(pending[0]?.count ?? 0);
  if (remainingUsd == null && pendingCount === 0) {
    return empty("No budget row or open part requests.");
  }
  return live({
    remainingUsd,
    pendingCount,
    href: "/business?tab=finance",
  });
}

async function attendanceTonight(client: PoolClient, ctx: HomeWidgetContext): Promise<Loaded> {
  const events = await query<{ id: string; title: string; kind: string; marks: string }>(
    client,
    `SELECT /* home-widget:attendance */ e.id, e.title, e.kind,
            (SELECT count(*)::text FROM attendance_entries a WHERE a.event_id = e.id) AS marks
       FROM attendance_events e
      WHERE e.org_id = $1::uuid AND e.occurred_on = CURRENT_DATE
      ORDER BY e.created_at DESC
      LIMIT 3`,
    [ctx.orgId],
  );
  if (events.length === 0) return empty("No session scheduled tonight.");
  return live({
    items: events.map((row) => ({
      id: row.id,
      title: row.title,
      kind: row.kind,
      marks: Number(row.marks ?? 0),
    })),
    href: "/team?tab=attendance",
  });
}

async function outreachHours(client: PoolClient, ctx: HomeWidgetContext): Promise<Loaded> {
  const rows = await query<{ hours: string }>(
    client,
    `SELECT /* home-widget:outreach_hours */
            COALESCE(SUM(EXTRACT(EPOCH FROM (COALESCE(clock_out, now()) - clock_in)) / 3600.0), 0)::text AS hours
       FROM hour_logs
      WHERE org_id = $1::uuid
        AND kind = 'outreach'
        AND clock_in >= date_trunc('month', now())`,
    [ctx.orgId],
  );
  const hours = Number(rows[0]?.hours ?? 0);
  if (!Number.isFinite(hours) || hours <= 0) return empty("No outreach hours logged this month.");
  return live({ hours: Math.round(hours * 10) / 10, href: "/business?tab=evidence" });
}

async function announcementsAck(client: PoolClient, ctx: HomeWidgetContext): Promise<Loaded> {
  const rows = await query<{ id: string; title: string; createdAt: string }>(
    client,
    `SELECT /* home-widget:announcements_ack */ a.id, a.title,
            ${ISO.replace("%s", "a.created_at")} AS "createdAt"
       FROM team_announcements a
      WHERE a.org_id = $1::uuid
        AND a.require_ack = true
        AND NOT EXISTS (
          SELECT 1 FROM announcement_acks k
           WHERE k.announcement_id = a.id AND k.user_id = $2::uuid
        )
      ORDER BY a.created_at DESC
      LIMIT 5`,
    [ctx.orgId, ctx.userId],
  );
  if (rows.length === 0) return empty("Nothing waiting on you.");
  return live({ items: rows, href: "/announcements" });
}

async function eventCountdown(client: PoolClient, ctx: HomeWidgetContext): Promise<Loaded> {
  if (!ctx.eventKey) return empty("No upcoming event on the calendar.");
  const rows = await query<{
    name: string;
    startDate: string | null;
    endDate: string | null;
    city: string | null;
  }>(
    client,
    `SELECT /* home-widget:event_countdown */ name, start_date::text AS "startDate",
            end_date::text AS "endDate", city
       FROM events_ref
      WHERE event_key = $1`,
    [ctx.eventKey],
  );
  const row = rows[0];
  if (!row?.startDate) return empty("No upcoming event on the calendar.");
  return live({
    name: row.name,
    startDate: row.startDate,
    endDate: row.endDate,
    city: row.city,
    href: "/command",
  });
}

async function hoursMonth(client: PoolClient, ctx: HomeWidgetContext): Promise<Loaded> {
  const rows = await query<{ hours: string }>(
    client,
    `SELECT /* home-widget:hours_month */
            COALESCE(SUM(EXTRACT(EPOCH FROM (COALESCE(clock_out, now()) - clock_in)) / 3600.0), 0)::text AS hours
       FROM hour_logs
      WHERE org_id = $1::uuid
        AND user_id = $2::uuid
        AND clock_in >= date_trunc('month', now())`,
    [ctx.orgId, ctx.userId],
  );
  const hours = Number(rows[0]?.hours ?? 0);
  if (!Number.isFinite(hours) || hours <= 0) return empty("No hours logged this month.");
  return live({ hours: Math.round(hours * 10) / 10, href: "/hours" });
}

async function calendarToday(client: PoolClient, ctx: HomeWidgetContext): Promise<Loaded> {
  const items = await query<{ id: string; title: string; startsAt: string }>(
    client,
    `SELECT /* home-widget:calendar_today */ e.id, e.title,
            ${ISO.replace("%s", "e.starts_at")} AS "startsAt"
       FROM subteam_calendar_events e
      WHERE e.org_id = $1::uuid
        AND e.starts_at >= date_trunc('day', now())
        AND e.starts_at < date_trunc('day', now()) + interval '7 days'
        AND (
          e.subteam_id IS NULL
          OR e.subteam_id IN (
            SELECT subteam_id FROM team_subteam_members
             WHERE org_id = $1::uuid AND user_id = $2::uuid
          )
        )
      ORDER BY e.starts_at ASC
      LIMIT 6`,
    [ctx.orgId, ctx.userId],
  );
  if (items.length === 0) return empty("Nothing on the calendar today.");
  return live({ items, href: "/team/calendar" });
}

async function cadResources(client: PoolClient, ctx: HomeWidgetContext): Promise<Loaded> {
  const docs = await query<{ id: string; title: string; externalUrl: string | null }>(
    client,
    `SELECT /* home-widget:cad_resources */ id, title, external_url AS "externalUrl"
       FROM cad_documents
      WHERE org_id = $1::uuid AND status = 'active'
      ORDER BY updated_at DESC
      LIMIT 5`,
    [ctx.orgId],
  );
  if (docs.length === 0) return empty("No CAD files or Onshape links yet.");
  return live({ items: docs, href: "/cad" });
}

async function codingResources(client: PoolClient, ctx: HomeWidgetContext): Promise<Loaded> {
  const rows = await query<{ repo: string | null; login: string | null }>(
    client,
    `SELECT /* home-widget:coding_resources */ default_repo_full_name AS repo, github_login AS login
       FROM github_connections
      WHERE org_id = $1::uuid AND disabled_at IS NULL AND status = 'connected'
      LIMIT 1`,
    [ctx.orgId],
  );
  const repo = rows[0]?.repo ?? null;
  if (!repo) return empty("No robot-code repo bound yet.");
  let openFindings = 0;
  try {
    const findings = await query<{ count: string }>(
      client,
      `SELECT /* home-widget:coding_resources-bugbot */ count(*)::text AS count
         FROM code_bugbot_reviews
        WHERE org_id = $1::uuid AND new_finding_count > 0`,
      [ctx.orgId],
    );
    openFindings = Number(findings[0]?.count ?? 0);
  } catch {
    // Table missing until Bugbot migrations; hide findings rather than invent them.
  }
  return live({ repo, login: rows[0]?.login ?? null, openFindings, href: "/code" });
}

async function teamProfile(client: PoolClient, ctx: HomeWidgetContext): Promise<Loaded> {
  const rows = await query<{
    status: string;
    nickname: string | null;
    city: string | null;
    rookieYear: number | null;
  }>(
    client,
    `SELECT /* home-widget:team_profile */ status,
            profile->>'nickname' AS nickname,
            profile->>'city' AS city,
            NULLIF(profile->>'rookie_year', '')::int AS "rookieYear"
       FROM team_dossiers
      WHERE org_id = $1::uuid`,
    [ctx.orgId],
  );
  const row = rows[0];
  if (!row || row.status !== "ready") {
    return empty("Team profile has not been built yet. Open Team profile.");
  }
  return live({
    nickname: row.nickname,
    city: row.city,
    teamNumber: ctx.teamNumber,
    rookieYear: row.rookieYear,
    href: "/team/profile",
  });
}

async function allianceDesk(client: PoolClient, ctx: HomeWidgetContext): Promise<Loaded> {
  if (!ctx.eventKey) return empty("Alliance selection is not running.");
  const rows = await query<{ id: string; name: string; status: string }>(
    client,
    `SELECT /* home-widget:alliance_desk */ id, name, status
       FROM alliance_selection_desk_sessions
      WHERE org_id = $1::uuid AND event_key = $2 AND status IN ('live', 'draft')
      ORDER BY CASE status WHEN 'live' THEN 0 ELSE 1 END, updated_at DESC
      LIMIT 1`,
    [ctx.orgId, ctx.eventKey],
  );
  const row = rows[0];
  if (!row) return empty("Alliance selection is not running.");
  return live({ name: row.name, status: row.status, href: "/alliance-selection-desk" });
}

async function matchSchedule(client: PoolClient, ctx: HomeWidgetContext): Promise<Loaded> {
  if (!ctx.eventKey) return empty("No match schedule synced for this event.");
  const teamKey = teamKeyOf(ctx.teamNumber);
  const items = await query<{
    matchKey: string;
    compLevel: string;
    matchNumber: number;
    scheduledTime: string | null;
  }>(
    client,
    `SELECT /* home-widget:match_schedule */ match_key AS "matchKey", comp_level AS "compLevel",
            match_number AS "matchNumber",
            COALESCE(predicted_time, event_time)::text AS "scheduledTime"
       FROM matches_ref
      WHERE event_key = $1
        AND ($2::text IS NULL OR red_alliance->'teamKeys' ? $2 OR blue_alliance->'teamKeys' ? $2)
        AND COALESCE(actual_time, predicted_time, event_time) > now()
      ORDER BY COALESCE(actual_time, predicted_time, event_time)
      LIMIT 6`,
    [ctx.eventKey, teamKey],
  );
  if (items.length === 0) return empty("No match schedule synced for this event.");
  return live({ items, href: "/schedule" });
}

async function batteries(client: PoolClient, ctx: HomeWidgetContext): Promise<Loaded> {
  const rows = await query<{ active: string; service: string }>(
    client,
    `SELECT /* home-widget:batteries */
            count(*) FILTER (WHERE status = 'active')::text AS active,
            count(*) FILTER (WHERE status = 'service')::text AS service
       FROM batteries
      WHERE org_id = $1::uuid`,
    [ctx.orgId],
  );
  const active = Number(rows[0]?.active ?? 0);
  const service = Number(rows[0]?.service ?? 0);
  if (active === 0 && service === 0) return empty("No batteries logged.");
  return live({ active, service, href: "/batteries" });
}

async function assemblyManual(client: PoolClient, ctx: HomeWidgetContext): Promise<Loaded> {
  const rows = await query<{ id: string; assemblyName: string | null; status: string }>(
    client,
    `SELECT /* home-widget:assembly_manual */ id, assembly_name AS "assemblyName", status
       FROM assembly_manual_runs
      WHERE org_id = $1::uuid
      ORDER BY created_at DESC
      LIMIT 1`,
    [ctx.orgId],
  );
  const row = rows[0];
  if (!row) return empty("No assembly manual yet. Open Assembly manual to start one.");
  return live({
    id: row.id,
    assemblyName: row.assemblyName,
    status: row.status,
    href: "/assembly-manual",
  });
}

async function sponsorFollowups(client: PoolClient, ctx: HomeWidgetContext): Promise<Loaded> {
  if (ctx.fundingModel === "school_funded_no_sponsors") {
    return empty("This team does not use sponsors.");
  }
  const items = await query<{ id: string; name: string; nextFollowUpOn: string }>(
    client,
    `SELECT /* home-widget:sponsor_followups */ id, name, next_follow_up_on::text AS "nextFollowUpOn"
       FROM sponsors
      WHERE org_id = $1::uuid
        AND next_follow_up_on IS NOT NULL
        AND next_follow_up_on <= CURRENT_DATE
      ORDER BY next_follow_up_on ASC
      LIMIT 5`,
    [ctx.orgId],
  );
  if (items.length === 0) return empty("No open sponsor follow-ups.");
  return live({ items, href: "/business?tab=sponsors" });
}

async function eventReadiness(client: PoolClient, ctx: HomeWidgetContext): Promise<Loaded> {
  if (!ctx.eventKey) return empty("No event on the calendar.");
  const packing = await query<{ packed: string; total: string }>(
    client,
    `SELECT /* home-widget:event_readiness */
            count(*) FILTER (WHERE i.packed)::text AS packed,
            count(*)::text AS total
       FROM packing_items i
       JOIN packing_lists l ON l.id = i.list_id
      WHERE l.org_id = $1::uuid AND l.event_key = $2`,
    [ctx.orgId, ctx.eventKey],
  );
  const packed = Number(packing[0]?.packed ?? 0);
  const total = Number(packing[0]?.total ?? 0);
  if (total === 0) return empty("Open packing to start a load-out for this event.");
  return live({
    packed,
    total,
    eventName: ctx.eventName,
    href: "/packing",
  });
}

async function weatherVenue(client: PoolClient, ctx: HomeWidgetContext): Promise<Loaded> {
  if (!ctx.eventKey) return empty("No event with a location — weather stays off until there is one.");
  const rows = await query<{
    city: string | null;
    stateProv: string | null;
    country: string | null;
    startDate: string | null;
    endDate: string | null;
    name: string;
  }>(
    client,
    `SELECT /* home-widget:weather_venue */ city, state_prov AS "stateProv", country,
            start_date::text AS "startDate", end_date::text AS "endDate", name
       FROM events_ref
      WHERE event_key = $1`,
    [ctx.eventKey],
  );
  const row = rows[0];
  const city = row?.city?.trim() || null;
  if (!row || !city) return empty("No event with a location — weather stays off until there is one.");
  const today = new Date().toISOString().slice(0, 10);
  const isEventDay = Boolean(
    row.startDate && row.endDate && today >= row.startDate && today <= row.endDate,
  );
  return live({
    city,
    stateProv: row.stateProv,
    country: row.country,
    startDate: row.startDate,
    endDate: row.endDate,
    name: row.name,
    isEventDay,
    href: "/command",
  });
}

export const HOME_WIDGET_LOADERS: Record<
  string,
  (client: PoolClient, ctx: HomeWidgetContext) => Promise<Loaded>
> = {
  my_day: myDay,
  learn_progress: learnProgress,
  files_recent: filesRecent,
  team_chat: teamChat,
  duties,
  budget_parts: budgetParts,
  attendance: attendanceTonight,
  outreach_hours: outreachHours,
  announcements_ack: announcementsAck,
  event_countdown: eventCountdown,
  hours_month: hoursMonth,
  calendar_today: calendarToday,
  cad_resources: cadResources,
  coding_resources: codingResources,
  team_profile: teamProfile,
  alliance_desk: allianceDesk,
  match_schedule: matchSchedule,
  batteries,
  assembly_manual: assemblyManual,
  sponsor_followups: sponsorFollowups,
  event_readiness: eventReadiness,
  weather_venue: weatherVenue,
};

export const HOME_WIDGET_TYPES = Object.keys(HOME_WIDGET_LOADERS) as DashboardWidgetType[];

const FALLBACK_MESSAGE: Record<string, string> = {
  my_day: "No matches on your day yet. Open My Day after TBA sync.",
  learn_progress: "Start Learn CAD or programming setup to see progress here.",
  files_recent: "No files opened yet. Open Files to add one.",
  team_chat: "No unread team chats.",
  duties: "Nothing needs assignment tonight.",
  budget_parts: "No budget row or open part requests.",
  attendance: "No session scheduled tonight.",
  outreach_hours: "No outreach hours logged this month.",
  announcements_ack: "Nothing waiting on you.",
  event_countdown: "No upcoming event on the calendar.",
  hours_month: "No hours logged this month.",
  calendar_today: "Nothing on the calendar today.",
  cad_resources: "No CAD files or Onshape links yet.",
  coding_resources: "No robot-code repo bound yet.",
  team_profile: "Team profile has not been built yet. Open Team profile.",
  alliance_desk: "Alliance selection is not running.",
  match_schedule: "No match schedule synced for this event.",
  batteries: "No batteries logged.",
  assembly_manual: "No assembly manual yet. Open Assembly manual to start one.",
  sponsor_followups: "No open sponsor follow-ups.",
  event_readiness: "No event on the calendar.",
  weather_venue: "No event with a location — weather stays off until there is one.",
};

export async function loadHomeWidget(
  client: PoolClient,
  type: DashboardWidgetType,
  ctx: HomeWidgetContext,
  stamp: (
    status: WidgetDataStatus,
    type: DashboardWidgetType,
    data?: Record<string, unknown>,
    message?: string,
  ) => StampedWidget,
): Promise<StampedWidget> {
  const loader = HOME_WIDGET_LOADERS[type];
  if (!loader) {
    return stamp("empty", type, undefined, FALLBACK_MESSAGE[type] ?? "Nothing yet.");
  }
  try {
    const result = await loader(client, ctx);
    return stamp(result.status, type, result.data, result.message);
  } catch {
    return stamp("empty", type, undefined, FALLBACK_MESSAGE[type] ?? "Nothing yet.");
  }
}
