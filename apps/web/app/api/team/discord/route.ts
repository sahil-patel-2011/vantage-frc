import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { isValidDiscordWebhook, postToDiscord } from "../../../../lib/discord";

// Team Discord connection for the alumni network. The webhook URL is a bearer
// secret: it is admin-only by RLS and never returned to the client (GET reports
// only whether it is configured). Admins can post announcements to the channel.

async function session() {
  const value = await auth.api.getSession({ headers: await headers() });
  if (!value) throw new Error("Authentication required");
  return value;
}

const fail = (error: unknown, status = 400) =>
  Response.json({ error: error instanceof Error ? error.message : "Discord request failed" }, { status });

async function assertAdmin(client: import("@neondatabase/serverless").PoolClient, orgId: string, userId: string) {
  const admin = await client.query(
    `SELECT 1 FROM memberships WHERE org_id=$1 AND user_id=$2 AND role IN ('owner','admin')`,
    [orgId, userId],
  );
  if (!admin.rowCount) throw new Error("Organization administrator access required");
}

export async function GET(request: Request) {
  try {
    const current = await session();
    const orgId = new URL(request.url).searchParams.get("orgId");
    if (!orgId) throw new Error("orgId is required");
    const data = await withRls({ userId: current.user.id, orgId }, async (client) => {
      await assertAdmin(client, orgId, current.user.id);
      const row = await client.query<{ channelLabel: string | null; enabled: boolean; updatedAt: string }>(
        `SELECT channel_label AS "channelLabel", enabled, updated_at AS "updatedAt"
         FROM team_discord WHERE org_id=$1`,
        [orgId],
      );
      return {
        configured: (row.rowCount ?? 0) > 0,
        channelLabel: row.rows[0]?.channelLabel ?? null,
        enabled: row.rows[0]?.enabled ?? false,
        updatedAt: row.rows[0]?.updatedAt ?? null,
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
      action?: "save" | "test" | "announce";
      webhookUrl?: string;
      channelLabel?: string;
      enabled?: boolean;
      message?: string;
    };
    if (!body.orgId) throw new Error("orgId is required");
    const orgId = body.orgId;

    const result = await withRls({ userId: current.user.id, orgId }, async (client) => {
      await assertAdmin(client, orgId, current.user.id);

      if (body.action === "save") {
        const webhookUrl = body.webhookUrl?.trim();
        if (!webhookUrl || !isValidDiscordWebhook(webhookUrl)) {
          throw new Error("Enter a valid Discord webhook URL (Server Settings → Integrations → Webhooks)");
        }
        await client.query(
          `INSERT INTO team_discord(org_id, webhook_url, channel_label, enabled, updated_by, updated_at)
           VALUES($1,$2,$3,$4,$5,now())
           ON CONFLICT(org_id) DO UPDATE SET webhook_url=excluded.webhook_url,
             channel_label=excluded.channel_label, enabled=excluded.enabled,
             updated_by=excluded.updated_by, updated_at=now()`,
          [orgId, webhookUrl, body.channelLabel?.trim() || null, body.enabled ?? true, current.user.id],
        );
        return { saved: true };
      }

      // test / announce both post to the stored webhook.
      const row = await client.query<{ webhookUrl: string; enabled: boolean }>(
        `SELECT webhook_url AS "webhookUrl", enabled FROM team_discord WHERE org_id=$1`,
        [orgId],
      );
      if (!row.rowCount) throw new Error("Connect a Discord webhook first");
      if (!row.rows[0]!.enabled) throw new Error("Discord posting is turned off for this team");
      const content =
        body.action === "test"
          ? "✅ Vantage is connected to this channel. Alumni-network announcements will post here."
          : (body.message ?? "").trim();
      if (body.action === "announce" && !content) throw new Error("Message is required");
      const post = await postToDiscord(row.rows[0]!.webhookUrl, content);
      if (!post.ok) throw new Error(post.error ?? "Discord rejected the message");
      return { posted: true };
    });
    return Response.json({ success: true, ...result });
  } catch (error) {
    return fail(error);
  }
}
