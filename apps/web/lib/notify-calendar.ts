import type { PoolClient } from "@neondatabase/serverless";
import { emitPreferredNotification } from "@vantage/core";
import { withSavepoint } from "@vantage/db";

function calendarHref(orgId: string, eventId: string): string {
  return `/team/calendar?orgId=${encodeURIComponent(orgId)}&eventId=${encodeURIComponent(eventId)}`;
}

/**
 * Notify subteam members (or whole-team members when subteamId is null) about a
 * new/updated calendar event. Skips the actor and respects in-app prefs.
 *
 * Self-protecting: every caller runs this after its own INSERT/UPDATE on the
 * shared `withRls` client, and every one of them had wrapped it in a bare
 * `try { … } catch {}` labelled "best-effort". It was not — a failure inside the
 * notify fan-out aborted the transaction, so the calendar event or visit invite
 * that had just been written was discarded at COMMIT while the route answered
 * 200 with an id. The savepoint lives here so no caller has to remember it;
 * a failed fan-out returns 0 notified and the write survives.
 */
export async function notifyCalendarEvent(
  client: PoolClient,
  input: {
    orgId: string;
    actorUserId: string;
    eventId: string;
    title: string;
    subteamId: string | null;
    mode?: "created" | "updated";
  },
): Promise<number> {
  return withSavepoint(client, () => fanOutCalendarEvent(client, input), 0);
}

async function fanOutCalendarEvent(
  client: PoolClient,
  input: {
    orgId: string;
    actorUserId: string;
    eventId: string;
    title: string;
    subteamId: string | null;
    mode?: "created" | "updated";
  },
): Promise<number> {
  const mode = input.mode ?? "created";
  const actor = await client.query<{ name: string }>(`SELECT name FROM users WHERE id = $1`, [
    input.actorUserId,
  ]);
  const actorName = actor.rows[0]?.name ?? "A teammate";

  let recipients: { userId: string }[];
  if (input.subteamId) {
    const rows = await client.query<{ userId: string }>(
      `SELECT user_id AS "userId" FROM team_subteam_members
       WHERE org_id = $1 AND subteam_id = $2`,
      [input.orgId, input.subteamId],
    );
    recipients = rows.rows;
  } else {
    const rows = await client.query<{ userId: string }>(
      `SELECT user_id AS "userId" FROM memberships WHERE org_id = $1`,
      [input.orgId],
    );
    recipients = rows.rows;
  }

  const type = mode === "updated" ? "calendar_updated" : "calendar_event";
  const title = mode === "updated" ? "Calendar event updated" : "New calendar event";
  const body =
    mode === "updated"
      ? `${actorName} updated “${input.title}”.`
      : `${actorName} scheduled “${input.title}”.`;
  const href = calendarHref(input.orgId, input.eventId);

  let emitted = 0;
  for (const recipient of recipients) {
    if (recipient.userId === input.actorUserId) continue;
    const result = await emitPreferredNotification(client, {
      userId: recipient.userId,
      orgId: input.orgId,
      type,
      payload: {
        title,
        body,
        eventId: input.eventId,
        href,
      },
    });
    if (result.emitted) emitted += 1;
  }
  return emitted;
}
