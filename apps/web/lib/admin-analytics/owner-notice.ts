import type { PoolClient } from "@neondatabase/serverless";
import { createEmailProvider, resolveAuthBaseURL, type EmailProvider } from "@vantage/core";

/**
 * Tell someone who already has an account that a platform admin just made them the owner of a
 * new team (QA A2-08: it happened silently, so the mentor learned they ran a second team by
 * chance). One email when email is set up, and one note in their Vantage inbox either way.
 */

export type OwnerNoticeDelivery = "sent" | "local" | "unconfigured" | "failed";

export function ownerNoticeText(input: { teamLabel: string; orgId: string; baseUrl: string }) {
  const home = `${input.baseUrl.replace(/\/$/, "")}/dashboard?orgId=${encodeURIComponent(input.orgId)}`;
  return {
    subject: `You're the owner of ${input.teamLabel} on Vantage`,
    message:
      `Vantage set up ${input.teamLabel} and made you its owner. ` +
      `Sign in with this email to invite your team and pick your event: ${home}\n\n` +
      "If you weren't expecting this, reply to this email and we'll sort it out.",
    title: `You're the owner of ${input.teamLabel}`,
    body: "Vantage set up this team for you. Start by inviting your mentors and students.",
    href: `/dashboard?orgId=${encodeURIComponent(input.orgId)}`,
  };
}

/** The email, after the team is committed. Never throws: a slow mail service can't undo a team. */
export async function emailNewOwner(
  input: { email: string; teamLabel: string; orgId: string },
  provider: EmailProvider = createEmailProvider(),
): Promise<{ emailSent: boolean; delivery: OwnerNoticeDelivery }> {
  // A local mailbox only logs, and an unconfigured one refuses: neither reaches a person.
  if (provider.name === "unconfigured") return { emailSent: false, delivery: "unconfigured" };
  const text = ownerNoticeText({ teamLabel: input.teamLabel, orgId: input.orgId, baseUrl: resolveAuthBaseURL() });
  try {
    await provider.sendSecurityNotice({ email: input.email, subject: text.subject, message: text.message });
    return provider.name === "local-mailbox" ? { emailSent: false, delivery: "local" } : { emailSent: true, delivery: "sent" };
  } catch {
    return { emailSent: false, delivery: "failed" };
  }
}

/** The inbox note, written as the new owner (notifications_self), inside their withRls. */
export async function noteNewOwner(client: Pick<PoolClient, "query">, input: { userId: string; orgId: string; teamLabel: string }) {
  const text = ownerNoticeText({ teamLabel: input.teamLabel, orgId: input.orgId, baseUrl: "" });
  await client.query(
    `INSERT INTO notifications (user_id, org_id, type, payload) VALUES ($1::uuid, $2::uuid, 'team_owner_added', $3::jsonb)`,
    [input.userId, input.orgId, JSON.stringify({ title: text.title, body: text.body, href: text.href })],
  );
}
