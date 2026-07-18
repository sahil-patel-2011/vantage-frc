import type { PoolClient } from "@neondatabase/serverless";
import { emitPreferredNotification } from "@vantage/core";
import {
  formatDiscordAnnouncement,
  isValidDiscordWebhook,
  postTeamDiscordMessage,
} from "./discord";
import { buildMyDayMatches, matchAlertBody, matchAlertTitle, type MyDayMatch } from "./my-day";
import type { ScheduleMatch } from "./schedule-board";

const COOLDOWN_MINUTES = 120;

export type MatchNotifyResult = {
  status: "skipped" | "sent" | "throttled" | "no_match";
  emitted: number;
  announced: boolean;
  discordPosted: boolean;
  matchKey: string | null;
  message?: string;
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

export async function loadScheduleMatchesForEvent(
  client: PoolClient,
  eventKey: string,
): Promise<ScheduleMatch[]> {
  const matches = await client.query<{
    matchKey: string;
    compLevel: string;
    matchNumber: number;
    scheduledTime: string | null;
    redAlliance: AllianceJson;
    blueAlliance: AllianceJson;
    winningAlliance: string | null;
  }>(
    `SELECT m.match_key AS "matchKey", m.comp_level AS "compLevel", m.match_number AS "matchNumber",
            COALESCE(m.actual_time, m.predicted_time, m.event_time)::text AS "scheduledTime",
            m.red_alliance AS "redAlliance", m.blue_alliance AS "blueAlliance",
            m.winning_alliance AS "winningAlliance"
     FROM matches_ref m
     WHERE m.event_key = $1
     ORDER BY CASE m.comp_level
                WHEN 'qm' THEN 0 WHEN 'ef' THEN 1 WHEN 'qf' THEN 2
                WHEN 'sf' THEN 3 WHEN 'f' THEN 4 ELSE 5
              END, m.match_number`,
    [eventKey],
  );

  return matches.rows.map((entry) => ({
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
}

/** After TBA sync: fan out next-match alerts (+ optional announcement/Discord). */
export async function notifyNextMatchReady(
  client: PoolClient,
  input: {
    orgId: string;
    actorUserId: string;
    eventKey: string;
    eventName: string | null;
    teamNumber: number | null;
    announce?: boolean;
  },
): Promise<MatchNotifyResult> {
  const teamKey = input.teamNumber ? `frc${input.teamNumber}` : null;
  if (!teamKey) {
    return { status: "skipped", emitted: 0, announced: false, discordPosted: false, matchKey: null };
  }

  const matches = await loadScheduleMatchesForEvent(client, input.eventKey);
  const { next } = buildMyDayMatches(matches, { orgId: input.orgId, teamKey });
  if (!next) {
    return { status: "no_match", emitted: 0, announced: false, discordPosted: false, matchKey: null };
  }

  const recent = await client.query<{ fingerprint: string | null }>(
    `SELECT payload->>'fingerprint' AS fingerprint
     FROM notifications
     WHERE org_id = $1::uuid
       AND type = 'match_alert'
       AND created_at > now() - ($2::text || ' minutes')::interval
       AND coalesce(payload->>'eventKey', '') = $3
     ORDER BY created_at DESC
     LIMIT 24`,
    [input.orgId, String(COOLDOWN_MINUTES), input.eventKey],
  );
  if (recent.rows.some((row) => row.fingerprint === next.matchKey)) {
    return {
      status: "throttled",
      emitted: 0,
      announced: false,
      discordPosted: false,
      matchKey: next.matchKey,
    };
  }

  const myDayHref = `/my-day?orgId=${encodeURIComponent(input.orgId)}`;
  const title = matchAlertTitle(next);
  const body = matchAlertBody({
    eventName: input.eventName,
    match: next,
    teamNumber: input.teamNumber,
  });

  const recipients = await client.query<{ userId: string }>(
    `SELECT user_id AS "userId" FROM memberships WHERE org_id = $1::uuid`,
    [input.orgId],
  );

  let emitted = 0;
  for (const recipient of recipients.rows) {
    const result = await emitPreferredNotification(client, {
      userId: recipient.userId,
      orgId: input.orgId,
      type: "match_alert",
      payload: {
        title,
        body,
        message: body,
        eventKey: input.eventKey,
        matchKey: next.matchKey,
        fingerprint: next.matchKey,
        ourAlliance: next.alliance,
        href: myDayHref,
      },
    });
    if (result.emitted) emitted += 1;
  }

  let announced = false;
  let discordPosted = false;
  if (input.announce !== false) {
    const announceResult = await maybeAnnounceMyDay(client, {
      orgId: input.orgId,
      actorUserId: input.actorUserId,
      eventName: input.eventName,
      next,
      teamNumber: input.teamNumber,
      myDayHref,
    });
    announced = announceResult.announced;
    discordPosted = announceResult.discordPosted;
  }

  return {
    status: emitted > 0 || announced ? "sent" : "skipped",
    emitted,
    announced,
    discordPosted,
    matchKey: next.matchKey,
    message: body,
  };
}

async function maybeAnnounceMyDay(
  client: PoolClient,
  input: {
    orgId: string;
    actorUserId: string;
    eventName: string | null;
    next: MyDayMatch;
    teamNumber: number | null;
    myDayHref: string;
  },
): Promise<{ announced: boolean; discordPosted: boolean }> {
  const title = matchAlertTitle(input.next);
  const body = [
    matchAlertBody({
      eventName: input.eventName,
      match: input.next,
      teamNumber: input.teamNumber,
    }),
    `Open My Day: ${input.myDayHref}`,
  ].join("\n");

  const existing = await client.query(
    `SELECT 1 FROM team_announcements
     WHERE org_id = $1::uuid AND title = $2
       AND created_at > now() - ($3::text || ' minutes')::interval
     LIMIT 1`,
    [input.orgId, title, String(COOLDOWN_MINUTES)],
  );
  if (existing.rowCount) return { announced: false, discordPosted: false };

  let discordPosted = false;
  try {
    const discord = await client.query<{
      webhookUrl: string | null;
      enabled: boolean;
      channelId: string | null;
    }>(
      `SELECT webhook_url AS "webhookUrl", enabled, channel_id AS "channelId"
       FROM team_discord WHERE org_id = $1`,
      [input.orgId],
    );
    if (discord.rowCount && discord.rows[0]!.enabled) {
      const webhookUrl =
        discord.rows[0]!.webhookUrl && isValidDiscordWebhook(discord.rows[0]!.webhookUrl)
          ? discord.rows[0]!.webhookUrl
          : null;
      const post = await postTeamDiscordMessage({
        content: formatDiscordAnnouncement(title, body),
        webhookUrl,
        channelId: discord.rows[0]!.channelId,
      });
      discordPosted = post.ok;
    }
  } catch {
    discordPosted = false;
  }

  try {
    await client.query(
      `INSERT INTO team_announcements (org_id, title, body, priority, pinned, require_ack, posted_to_discord, created_by)
       VALUES ($1, $2, $3, 'important', false, false, $4, $5)`,
      [input.orgId, title, body, discordPosted, input.actorUserId],
    );
  } catch {
    try {
      await client.query(
        `INSERT INTO team_announcements (org_id, title, body, posted_to_discord, created_by)
         VALUES ($1, $2, $3, $4, $5)`,
        [input.orgId, title, body, discordPosted, input.actorUserId],
      );
    } catch {
      return { announced: false, discordPosted };
    }
  }

  return { announced: true, discordPosted };
}
