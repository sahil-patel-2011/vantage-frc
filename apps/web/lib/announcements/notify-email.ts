/**
 * Emailing an announcement — and, mostly, not emailing one.
 *
 * `/announcements` fans every post out to the in-app inbox. That is the right
 * default and it stays the default: a team posts a lot, and a member who gets
 * mail for all of it learns to route the team's address to a folder they never
 * open. The one time that costs something real is the notice that had to be
 * read today — the departure time moved, the shop is closed, the permission
 * slip is due tomorrow — and by then the filter is already in place.
 *
 * So email is reserved for the two cases where the poster has said, in the
 * product, that reaching people matters more than not interrupting them:
 * `urgent` priority, or `require_ack`. Everything else is inbox-only.
 *
 * Delivery is consent-gated by the `announcements` category (0603) and carries
 * the standard unsubscribe footer, so a member who does not want even these can
 * leave in one click without losing anything else.
 */

import type { PoolClient } from "@neondatabase/serverless";
import { sendAnnouncementEmails, type BulkEmailResult } from "@vantage/core";
import type { AnnouncementPriority } from "./store";

/** A big team is still one send; this is a ceiling on a runaway, not a policy. */
const MAX_EMAIL_RECIPIENTS = 400;

export function shouldEmailAnnouncement(input: {
  priority: AnnouncementPriority;
  requireAck: boolean;
}): boolean {
  return input.priority === "urgent" || input.requireAck;
}

export type AnnouncementEmailOutcome =
  | { attempted: false; reason: "not_urgent" | "no_recipients" }
  | ({ attempted: true } & BulkEmailResult);

/**
 * Email the team about one announcement.
 *
 * Call this AFTER the announcement has committed. Sending inside the same
 * transaction risks mailing 40 people about a notice that then rolls back, and
 * an email is the one side effect that cannot be rolled back with it.
 */
export async function emailAnnouncement(
  client: PoolClient,
  input: {
    orgId: string;
    orgName: string;
    authorId: string;
    title: string;
    body: string;
    priority: AnnouncementPriority;
    requireAck: boolean;
    baseUrl: string;
  },
): Promise<AnnouncementEmailOutcome> {
  if (!shouldEmailAnnouncement(input)) return { attempted: false, reason: "not_urgent" };

  const members = await client.query<{ userId: string }>(
    `SELECT m.user_id AS "userId"
       FROM memberships m
      WHERE m.org_id = $1::uuid
        AND m.user_id <> $2::uuid
      ORDER BY m.created_at
      LIMIT $3::int`,
    [input.orgId, input.authorId, MAX_EMAIL_RECIPIENTS],
  );
  if (members.rows.length === 0) return { attempted: false, reason: "no_recipients" };

  const result = await sendAnnouncementEmails(client, {
    userIds: members.rows.map((row) => row.userId),
    orgName: input.orgName,
    title: input.title,
    body: input.body,
    priority: input.priority,
    requireAck: input.requireAck,
    href: `${input.baseUrl.replace(/\/$/, "")}/announcements`,
  });
  return { attempted: true, ...result };
}

/**
 * One sentence for the poster about what actually left the building.
 *
 * The poster is about to walk away believing the team has been told. If eleven
 * of thirty had turned email off, or the deployment has no mail provider, that
 * is the moment to say so — not to report a cheerful "sent".
 */
export function describeAnnouncementEmail(outcome: AnnouncementEmailOutcome): string {
  if (!outcome.attempted) {
    return outcome.reason === "no_recipients"
      ? "No other members to email yet."
      : "Posted to the team inbox. Mark an announcement urgent, or require acknowledgement, to email it as well.";
  }
  if (outcome.setupRequired) {
    return `Posted to the team inbox. Email was not sent: ${outcome.setupRequired}`;
  }
  const optedOut = outcome.candidates - outcome.eligible;
  const parts = [`Emailed ${outcome.sent} of ${outcome.candidates}`];
  if (optedOut > 0) parts.push(`${optedOut} have this category turned off`);
  if (outcome.failed > 0) parts.push(`${outcome.failed} failed to send`);
  return `${parts.join(" · ")}.`;
}
