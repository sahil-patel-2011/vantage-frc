import type { PoolClient } from "@neondatabase/serverless";
import { withSavepoint } from "@vantage/db";
import {
  formatDiscordBridgeMessage,
  isValidDiscordWebhook,
  postTeamDiscordMessage,
} from "../discord";
import type { MessageObjectLink } from "./object-links";

/**
 * Mirror an object-linked team message to Discord when the org bridge is on. Never throws.
 *
 * The information_schema probes below exist because these tables are genuinely
 * optional — which is exactly why the old bare catch was dangerous. This runs on
 * the shared `withRls` client immediately after the message INSERT; one failing
 * statement aborted the transaction and the COMMIT dropped the message with it,
 * behind a 200. The savepoint confines a bridge failure to the bridge.
 */
export async function maybeBridgeObjectLinkedMessage(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    messageId: string;
    conversationId: string;
    body: string;
    objectLink: MessageObjectLink;
  },
): Promise<void> {
  await withSavepoint(client, async () => {
    const bridgeTable = await client.query(
      `SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'discord_bridge_posts' LIMIT 1`,
    );
    const discordCols = await client.query(
      `SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'team_discord'
         AND column_name = 'chat_bridge_enabled' LIMIT 1`,
    );
    if (!bridgeTable.rowCount || !discordCols.rowCount) return;

    const cfg = await client.query<{
      webhookUrl: string | null;
      enabled: boolean;
      channelId: string | null;
      chatBridgeEnabled: boolean;
    }>(
      `SELECT webhook_url AS "webhookUrl", enabled, channel_id AS "channelId",
              chat_bridge_enabled AS "chatBridgeEnabled"
       FROM team_discord WHERE org_id=$1`,
      [input.orgId],
    );
    if (!cfg.rowCount || !cfg.rows[0]!.enabled || !cfg.rows[0]!.chatBridgeEnabled) return;

    const author = await client.query<{ name: string }>(`SELECT name FROM users WHERE id = $1`, [input.userId]);
    const appBase = (process.env.NEXT_PUBLIC_APP_URL ?? process.env.BETTER_AUTH_URL ?? "").replace(/\/$/, "");
    const appHref = appBase
      ? `${appBase}/messages?orgId=${encodeURIComponent(input.orgId)}&conversationId=${encodeURIComponent(input.conversationId)}`
      : null;
    const content = formatDiscordBridgeMessage({
      authorName: author.rows[0]?.name ?? "Teammate",
      body: input.body,
      objectLink: input.objectLink,
      appHref,
    });
    const webhookUrl =
      cfg.rows[0]!.webhookUrl && isValidDiscordWebhook(cfg.rows[0]!.webhookUrl)
        ? cfg.rows[0]!.webhookUrl
        : null;
    const post = await postTeamDiscordMessage({
      content,
      webhookUrl,
      channelId: cfg.rows[0]!.channelId,
    });
    await client.query(
      `INSERT INTO discord_bridge_posts (message_id, org_id, discord_message_id, status, error)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (message_id) DO NOTHING`,
      [
        input.messageId,
        input.orgId,
        post.messageId ?? null,
        post.ok ? "posted" : "failed",
        post.ok ? null : (post.error ?? "Discord rejected the message"),
      ],
    );
  }, undefined);
}
