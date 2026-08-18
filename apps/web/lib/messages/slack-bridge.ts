import type { PoolClient } from "@neondatabase/serverless";
import { formatSlackBridgeMessage, isValidSlackWebhook, postToSlackWebhook } from "../slack";

/** Mirror a Team-channel message to Slack when the org bridge is on. Never throws. */
export async function maybeBridgeTeamSlackMessage(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    messageId: string;
    conversationId: string;
    body: string;
  },
): Promise<void> {
  try {
    const existing = await client.query(
      `SELECT 1 FROM slack_bridge_posts WHERE message_id = $1::uuid LIMIT 1`,
      [input.messageId],
    );
    if (existing.rowCount) return;

    const cfg = await client.query<{
      webhookUrl: string | null;
      enabled: boolean;
      chatBridgeEnabled: boolean;
    }>(
      `SELECT webhook_url AS "webhookUrl", enabled, chat_bridge_enabled AS "chatBridgeEnabled"
       FROM team_slack WHERE org_id = $1::uuid`,
      [input.orgId],
    );
    if (!cfg.rowCount || !cfg.rows[0]!.enabled || !cfg.rows[0]!.chatBridgeEnabled) return;
    const webhookUrl =
      cfg.rows[0]!.webhookUrl && isValidSlackWebhook(cfg.rows[0]!.webhookUrl)
        ? cfg.rows[0]!.webhookUrl
        : null;
    if (!webhookUrl) return;

    const author = await client.query<{ name: string }>(`SELECT name FROM users WHERE id = $1`, [input.userId]);
    const appBase = (process.env.NEXT_PUBLIC_APP_URL ?? process.env.BETTER_AUTH_URL ?? "").replace(/\/$/, "");
    const appHref = appBase
      ? `${appBase}/team?tab=messages&orgId=${encodeURIComponent(input.orgId)}&conversationId=${encodeURIComponent(input.conversationId)}`
      : null;
    const post = await postToSlackWebhook(
      webhookUrl,
      formatSlackBridgeMessage({
        authorName: author.rows[0]?.name ?? "Teammate",
        body: input.body,
        appHref,
      }),
    );
    await client.query(
      `INSERT INTO slack_bridge_posts (message_id, org_id, slack_ts, direction, status, error)
       VALUES ($1, $2, $3, 'outbound', $4, $5)
       ON CONFLICT (message_id) DO NOTHING`,
      [
        input.messageId,
        input.orgId,
        post.ts ?? null,
        post.ok ? "posted" : "failed",
        post.ok ? null : (post.error ?? "Slack rejected the message"),
      ],
    );
  } catch {
    /* bridge must never block in-app send */
  }
}
