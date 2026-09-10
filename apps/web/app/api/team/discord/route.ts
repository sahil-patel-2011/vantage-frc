import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  discordSetupStatus,
  formatDiscordAnnouncement,
  formatDiscordBridgeMessage,
  isValidDiscordSnowflake,
  isValidDiscordWebhook,
  postTeamDiscordMessage,
} from "../../../../lib/discord";
import { canPostViaDiscord } from "../../../../lib/discord-related";

async function session() {
  const value = await auth.api.getSession({ headers: await headers() });
  if (!value) throw new Error("Authentication required");
  return value;
}

/**
 * Same status-code fix as Slack: an expired session answered 400, so the client
 * offered Retry instead of sign-in, and a non-admin answered 400, which reads as
 * a malformed request rather than "ask an owner or admin".
 */
const fail = (error: unknown, status = 400) => {
  const message = error instanceof Error ? error.message : "Discord request failed";
  if (/authentication required/i.test(message)) return Response.json({ error: message }, { status: 401 });
  if (/administrator access required/i.test(message)) return Response.json({ error: message }, { status: 403 });
  return Response.json({ error: message }, { status });
};

async function assertAdmin(client: import("@neondatabase/serverless").PoolClient, orgId: string, userId: string) {
  const admin = await client.query(
    `SELECT 1 FROM memberships WHERE org_id=$1 AND user_id=$2 AND role IN ('owner','admin')`,
    [orgId, userId],
  );
  if (!admin.rowCount) throw new Error("Organization administrator access required");
}

type DiscordRow = {
  channelLabel: string | null;
  enabled: boolean;
  updatedAt: string;
  guildId: string | null;
  guildName: string | null;
  channelId: string | null;
  chatBridgeEnabled: boolean;
  hasWebhook: boolean;
};

async function loadDiscordRow(
  client: import("@neondatabase/serverless").PoolClient,
  orgId: string,
): Promise<DiscordRow | null> {
  try {
    const row = await client.query<{
      channelLabel: string | null;
      enabled: boolean;
      updatedAt: string;
      guildId: string | null;
      guildName: string | null;
      channelId: string | null;
      chatBridgeEnabled: boolean;
      webhookUrl: string | null;
    }>(
      `SELECT channel_label AS "channelLabel", enabled, updated_at AS "updatedAt",
              guild_id AS "guildId", guild_name AS "guildName", channel_id AS "channelId",
              chat_bridge_enabled AS "chatBridgeEnabled", webhook_url AS "webhookUrl"
       FROM team_discord WHERE org_id=$1`,
      [orgId],
    );
    if (!row.rowCount) return null;
    const r = row.rows[0]!;
    return {
      channelLabel: r.channelLabel,
      enabled: r.enabled,
      updatedAt: r.updatedAt,
      guildId: r.guildId,
      guildName: r.guildName,
      channelId: r.channelId,
      chatBridgeEnabled: r.chatBridgeEnabled,
      hasWebhook: Boolean(r.webhookUrl && isValidDiscordWebhook(r.webhookUrl)),
    };
  } catch {
    const row = await client.query<{
      channelLabel: string | null;
      enabled: boolean;
      updatedAt: string;
      webhookUrl: string | null;
    }>(
      `SELECT channel_label AS "channelLabel", enabled, updated_at AS "updatedAt",
              webhook_url AS "webhookUrl"
       FROM team_discord WHERE org_id=$1`,
      [orgId],
    );
    if (!row.rowCount) return null;
    const r = row.rows[0]!;
    return {
      channelLabel: r.channelLabel,
      enabled: r.enabled,
      updatedAt: r.updatedAt,
      guildId: null,
      guildName: null,
      channelId: null,
      chatBridgeEnabled: false,
      hasWebhook: Boolean(r.webhookUrl && isValidDiscordWebhook(r.webhookUrl)),
    };
  }
}

async function loadBridgePostCounts(
  client: import("@neondatabase/serverless").PoolClient,
  orgId: string,
): Promise<{ posted: number; failed: number } | null> {
  try {
    const counts = await client.query<{ status: string; total: string }>(
      `SELECT status, count(*)::text AS total
       FROM discord_bridge_posts
       WHERE org_id = $1::uuid
       GROUP BY status`,
      [orgId],
    );
    let posted = 0;
    let failed = 0;
    for (const row of counts.rows) {
      const n = Number(row.total);
      if (!Number.isFinite(n)) continue;
      if (row.status === "posted") posted = n;
      else if (row.status === "failed") failed = n;
    }
    return { posted, failed };
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  try {
    const current = await session();
    const orgId = new URL(request.url).searchParams.get("orgId");
    if (!orgId) throw new Error("orgId is required");
    const setup = discordSetupStatus();
    const data = await withRls({ userId: current.user.id, orgId }, async (client) => {
      await assertAdmin(client, orgId, current.user.id);
      const connection = await loadDiscordRow(client, orgId);
      const configured = Boolean(connection);
      const hasWebhook = connection?.hasWebhook ?? false;
      const channelId = connection?.channelId ?? null;
      const platformConfigured = setup.configured;
      const canPost = canPostViaDiscord({ hasWebhook, channelId, platformConfigured });
      // setup_required when posting cannot succeed (no webhook and no bot token path).
      const setupRequired = !canPost;
      const bridgePosts = configured ? await loadBridgePostCounts(client, orgId) : null;
      return {
        status: !configured ? "empty" : setupRequired ? "setup_required" : "live",
        orgId,
        configured,
        platformConfigured,
        setupRequired,
        canPost,
        inviteUrl: setup.inviteUrl,
        message: !configured
          ? "Link a Discord guild and channel for announcements and an optional object-linked chat bridge."
          : setupRequired
            ? hasWebhook || channelId
              ? "Add a valid channel webhook, or set DISCORD_BOT_TOKEN on the server with a channel id, before posting."
              : "Provide a channel webhook URL and/or a Discord channel id to finish setup."
            : setup.message,
        channelLabel: connection?.channelLabel ?? null,
        enabled: connection?.enabled ?? false,
        updatedAt: connection?.updatedAt ?? null,
        guildId: connection?.guildId ?? null,
        guildName: connection?.guildName ?? null,
        channelId,
        chatBridgeEnabled: connection?.chatBridgeEnabled ?? false,
        hasWebhook,
        empty: !configured,
        emptyReason: configured
          ? null
          : "No Discord guild/channel linked yet. Paste a webhook or set guild + channel ids.",
        // Real discord_bridge_posts only — null when table unavailable, never DEMO sync %.
        bridgePosts,
      };
    });
    return Response.json(data);
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    const current = await session();
    const body = (await request.json()) as {
      orgId?: string;
      action?: "save" | "disconnect" | "test" | "announce" | "digest" | "set-bridge";
      webhookUrl?: string;
      channelLabel?: string;
      enabled?: boolean;
      guildId?: string;
      guildName?: string;
      channelId?: string;
      chatBridgeEnabled?: boolean;
      message?: string;
      title?: string;
    };
    if (!body.orgId) throw new Error("orgId is required");
    const orgId = body.orgId;
    const action = body.action ?? "save";

    const result = await withRls({ userId: current.user.id, orgId }, async (client) => {
      await assertAdmin(client, orgId, current.user.id);

      if (action === "disconnect") {
        await client.query(`DELETE FROM team_discord WHERE org_id=$1`, [orgId]);
        return { disconnected: true };
      }

      if (action === "set-bridge") {
        const existing = await client.query(`SELECT 1 FROM team_discord WHERE org_id=$1`, [orgId]);
        if (!existing.rowCount) throw new Error("Connect Discord before enabling the chat bridge");
        await client.query(
          `UPDATE team_discord SET chat_bridge_enabled=$2, updated_by=$3, updated_at=now() WHERE org_id=$1`,
          [orgId, Boolean(body.chatBridgeEnabled), current.user.id],
        );
        return { chatBridgeEnabled: Boolean(body.chatBridgeEnabled) };
      }

      if (action === "save") {
        const guildId = body.guildId?.trim() || null;
        const channelId = body.channelId?.trim() || null;
        if (guildId && !isValidDiscordSnowflake(guildId)) {
          throw new Error("Guild id must be a Discord snowflake (numeric)");
        }
        if (channelId && !isValidDiscordSnowflake(channelId)) {
          throw new Error("Channel id must be a Discord snowflake (numeric)");
        }

        const existing = await client.query<{ webhookUrl: string | null }>(
          `SELECT webhook_url AS "webhookUrl" FROM team_discord WHERE org_id=$1`,
          [orgId],
        );
        const clearWebhook = body.webhookUrl === "";
        let webhookUrl: string | null = null;
        if (clearWebhook) webhookUrl = null;
        else if (body.webhookUrl?.trim()) {
          webhookUrl = body.webhookUrl.trim();
          if (!isValidDiscordWebhook(webhookUrl)) {
            throw new Error("Enter a valid Discord webhook URL (Server Settings → Integrations → Webhooks)");
          }
        } else if (existing.rowCount) {
          webhookUrl = existing.rows[0]!.webhookUrl;
        }

        if (!webhookUrl && !channelId) {
          throw new Error("Provide a channel webhook URL and/or a Discord channel id");
        }

        await client.query(
          `INSERT INTO team_discord(
             org_id, webhook_url, channel_label, enabled, updated_by, updated_at,
             guild_id, guild_name, channel_id, chat_bridge_enabled
           )
           VALUES($1,$2,$3,$4,$5,now(),$6,$7,$8,$9)
           ON CONFLICT(org_id) DO UPDATE SET
             webhook_url=excluded.webhook_url,
             channel_label=excluded.channel_label,
             enabled=excluded.enabled,
             updated_by=excluded.updated_by,
             updated_at=now(),
             guild_id=excluded.guild_id,
             guild_name=excluded.guild_name,
             channel_id=excluded.channel_id,
             chat_bridge_enabled=excluded.chat_bridge_enabled`,
          [
            orgId,
            webhookUrl,
            body.channelLabel?.trim() || null,
            body.enabled ?? true,
            current.user.id,
            guildId,
            body.guildName?.trim() || null,
            channelId,
            body.chatBridgeEnabled ?? false,
          ],
        );
        return { saved: true };
      }

      const row = await client.query<{
        webhookUrl: string | null;
        enabled: boolean;
        channelId: string | null;
      }>(
        `SELECT webhook_url AS "webhookUrl", enabled, channel_id AS "channelId"
         FROM team_discord WHERE org_id=$1`,
        [orgId],
      ).catch(async () =>
        client.query<{ webhookUrl: string | null; enabled: boolean; channelId: string | null }>(
          `SELECT webhook_url AS "webhookUrl", enabled, NULL::text AS "channelId"
           FROM team_discord WHERE org_id=$1`,
          [orgId],
        ),
      );
      if (!row.rowCount) throw new Error("Connect a Discord guild/channel first");
      if (!row.rows[0]!.enabled) throw new Error("Discord posting is turned off for this team");

      const webhookUrl =
        row.rows[0]!.webhookUrl && isValidDiscordWebhook(row.rows[0]!.webhookUrl)
          ? row.rows[0]!.webhookUrl
          : null;
      const channelId = row.rows[0]!.channelId;

      let content: string;
      if (action === "test") {
        content = formatDiscordBridgeMessage({
          authorName: "Vantage",
          body: "Connected. Announcements and optional object-linked chat bridges will post here.",
        });
      } else if (action === "digest") {
        const stats = await client.query<{ total: string }>(
          `SELECT count(*) AS total FROM team_alumni WHERE org_id=$1`,
          [orgId],
        );
        const recent = await client.query<{ fullName: string; gradYear: number | null }>(
          `SELECT full_name AS "fullName", grad_year AS "gradYear" FROM team_alumni
           WHERE org_id=$1 ORDER BY created_at DESC LIMIT 5`,
          [orgId],
        );
        const total = Number(stats.rows[0]?.total ?? 0);
        if (!total) throw new Error("Add some alumni before posting a digest");
        const names = recent.rows
          .map((r) => `• ${r.fullName}${r.gradYear ? ` ’${String(r.gradYear).slice(2)}` : ""}`)
          .join("\n");
        content = `📇 **Alumni network update** — ${total} alum${total === 1 ? "" : "s"} in our directory.\nRecently added:\n${names}`;
      } else if (action === "announce") {
        const title = (body.title ?? "").trim() || "Announcement";
        const message = (body.message ?? "").trim();
        if (!message) throw new Error("Message is required");
        content = formatDiscordAnnouncement(title, message);
      } else {
        content = (body.message ?? "").trim();
        if (!content) throw new Error("Message is required");
      }

      const post = await postTeamDiscordMessage({ content, webhookUrl, channelId });
      if (!post.ok) throw new Error(post.error ?? "Discord rejected the message");
      return { posted: true, messageId: post.messageId ?? null };
    });
    return Response.json({ success: true, ...result });
  } catch (error) {
    return fail(error);
  }
}
