import type { PoolClient } from "@neondatabase/serverless";
import { createEmailProvider, resolveAuthBaseURL, type EmailProvider } from "@vantage/core";
import { withRls } from "@vantage/db";
import { CREDIT_GIFT_FAMILIES, formatGiftUsd, isCreditGiftFamily, setCreditGiftAlertMailer } from "@vantage/billing";

/**
 * Email that follows a gift's inbox notices (the database writes those, migration 0727): when it
 * is granted, at 80% and when it is used up. Only when mail is configured; with no email set up
 * it is skipped quietly, and the inbox notice is still there.
 */

export type GiftMailKind = "granted" | "80" | "exhausted";

export function giftEmailText(
  kind: GiftMailKind,
  gift: { amountUsd: number; usedUsd: number; familyLabel: string; note?: string | null; expiresAt?: string | null },
  baseUrl: string,
): { subject: string; text: string } {
  const link = `${baseUrl.replace(/\/$/, "")}/team/ai-keys`;
  const amount = formatGiftUsd(gift.amountUsd);
  const used = `${formatGiftUsd(gift.usedUsd, true)} of ${formatGiftUsd(gift.amountUsd, true)}`;
  if (kind === "granted") {
    const until = gift.expiresAt
      ? ` until ${new Date(gift.expiresAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" })}`
      : "";
    return {
      subject: `Vantage gave your team ${amount} of AI credit`,
      text: [
        `Vantage gave your team ${amount} of AI credit for ${gift.familyLabel}${until}.`,
        `Ask AI uses it automatically. It stops at ${amount}, so there is never a bill.`,
        gift.note ? `Note from Vantage: ${gift.note}` : "",
        `See what's used: ${link}`,
      ]
        .filter(Boolean)
        .join("\n\n"),
    };
  }
  if (kind === "80") {
    return {
      subject: "80% of your free AI credit is used",
      text: [
        `${used} of your team's free AI credit from Vantage is used.`,
        "Ask AI stops when it runs out. To keep going after that, add your own AI key in AI settings.",
        link,
      ].join("\n\n"),
    };
  }
  return {
    subject: "Your free AI credit from Vantage is used up",
    text: [
      `${used} used. Ask AI won't use Vantage's credit any more.`,
      "Add your own AI key in AI settings to keep using Ask AI. Everything else in Vantage keeps working.",
      link,
    ].join("\n\n"),
  };
}

/** The team's owners and admins: who the notices are for. */
export async function giftRecipientEmails(client: Pick<PoolClient, "query">, orgId: string): Promise<string[]> {
  const result = await client.query<{ email: string }>(
    `SELECT DISTINCT u.email
       FROM memberships m JOIN users u ON u.id = m.user_id
      WHERE m.org_id = $1::uuid AND m.role IN ('owner', 'admin')
        AND u.email NOT LIKE '%@deleted.invalid'`,
    [orgId],
  );
  return result.rows.map((row) => row.email).filter(Boolean);
}

/** Send one notice to each owner and admin. Returns how many were sent; never throws. */
export async function emailGiftNotice(
  client: Pick<PoolClient, "query">,
  input: { orgId: string; kind: GiftMailKind; gift: Parameters<typeof giftEmailText>[1] },
  provider: EmailProvider = createEmailProvider(),
): Promise<number> {
  // An unconfigured provider refuses and the local one only logs: no email is set up here.
  if (provider.name === "unconfigured") return 0;
  try {
    const recipients = await giftRecipientEmails(client, input.orgId);
    const text = giftEmailText(input.kind, input.gift, resolveAuthBaseURL());
    let sent = 0;
    for (const to of recipients) {
      try {
        await provider.sendFreeform({ to, subject: text.subject, text: text.text });
        sent += 1;
      } catch {
        // One bad address never stops the rest.
      }
    }
    return sent;
  } catch {
    return 0;
  }
}

/** The 80% / used-up mailer the gift adapter calls after a settle fires an alert. */
export function registerCreditGiftMailer(): void {
  setCreditGiftAlertMailer(async ({ orgId, userId, giftId, alert }) => {
    await withRls({ userId, orgId }, async (client) => {
      const result = await client.query<{ family: string; amountUsd: string; spentUsd: string }>(
        `SELECT family, amount_usd::text AS "amountUsd", spent_usd::text AS "spentUsd"
           FROM ai_credit_gift_summary($1::uuid) WHERE gift_id = $2::uuid`,
        [orgId, giftId],
      );
      const row = result.rows[0];
      if (!row || !isCreditGiftFamily(row.family)) return;
      const amountUsd = Number(row.amountUsd);
      await emailGiftNotice(client, {
        orgId,
        kind: alert,
        gift: {
          amountUsd,
          usedUsd: Math.min(amountUsd, Number(row.spentUsd)),
          familyLabel: CREDIT_GIFT_FAMILIES[row.family].label,
        },
      });
    });
  });
}
