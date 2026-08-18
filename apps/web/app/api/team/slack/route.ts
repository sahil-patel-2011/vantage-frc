import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  isValidSlackChannelId,
  isValidSlackWebhook,
  isValidSlackWorkspaceId,
  postToSlackWebhook,
  slackSetupStatus,
} from "../../../../lib/slack";
import { formatSlackBridgePostCount } from "../../../../lib/slack-related";

async function session() {
  const value = await auth.api.getSession({ headers: await headers() });
  if (!value) throw new Error("Authentication required");
  return value;
}

const fail = (error: unknown, status = 400) =>
  Response.json({ error: error instanceof Error ? error.message : "Slack request failed" }, { status });

async function assertAdmin(client: import("@neondatabase/serverless").PoolClient, orgId: string, userId: string) {
  const admin = await client.query(
    `SELECT 1 FROM memberships WHERE org_id=$1 AND user_id=$2 AND role IN ('owner','admin')`,
    [orgId, userId],
  );
  if (!admin.rowCount) throw new Error("Organization administrator access required");
}

type SlackRow = {
  channelLabel: string | null;
  enabled: boolean;
  updatedAt: string;
  workspaceId: string | null;
  workspaceName: string | null;
  channelId: string | null;
  chatBridgeEnabled: boolean;
  hasWebhook: boolean;
  hasSigningSecret: boolean;
};

async function loadSlackRow(
  client: import("@neondatabase/serverless").PoolClient,
  orgId: string,
): Promise<SlackRow | null> {
  const row = await client.query<{
    channelLabel: string | null;
    enabled: boolean;
    updatedAt: string;
    workspaceId: string | null;
    workspaceName: string | null;
    channelId: string | null;
    chatBridgeEnabled: boolean;
    webhookUrl: string | null;
    signingSecret: string | null;
  }>(
    `SELECT channel_label AS "channelLabel", enabled, updated_at AS "updatedAt",
            workspace_id AS "workspaceId", workspace_name AS "workspaceName",
            channel_id AS "channelId", chat_bridge_enabled AS "chatBridgeEnabled",
            webhook_url AS "webhookUrl", signing_secret AS "signingSecret"
     FROM team_slack WHERE org_id=$1`,
    [orgId],
  );
  if (!row.rowCount) return null;
  const r = row.rows[0]!;
  return {
    channelLabel: r.channelLabel,
    enabled: r.enabled,
    updatedAt: r.updatedAt,
    workspaceId: r.workspaceId,
    workspaceName: r.workspaceName,
    channelId: r.channelId,
    chatBridgeEnabled: r.chatBridgeEnabled,
    hasWebhook: Boolean(r.webhookUrl && isValidSlackWebhook(r.webhookUrl)),
    hasSigningSecret: Boolean(r.signingSecret?.trim()),
  };
}

export async function GET(request: Request) {
  try {
    const current = await session();
    const orgId = new URL(request.url).searchParams.get("orgId");
    if (!orgId) throw new Error("orgId is required");
    const setup = slackSetupStatus();
    const data = await withRls({ userId: current.user.id, orgId }, async (client) => {
      await assertAdmin(client, orgId, current.user.id);
      const connection = await loadSlackRow(client, orgId);
      const configured = Boolean(connection);
      const hasWebhook = connection?.hasWebhook ?? false;
      const inboundReady = setup.configured || Boolean(connection?.hasSigningSecret);
      let bridgePosts: { posted: number; failed: number } | null = null;
      if (configured) {
        const counts = await client.query<{ status: string; total: string }>(
          `SELECT status, count(*)::text AS total
           FROM slack_bridge_posts WHERE org_id=$1::uuid GROUP BY status`,
          [orgId],
        );
        let posted = 0;
        let failed = 0;
        for (const row of counts.rows) {
          const n = Number(row.total);
          if (!Number.isFinite(n)) continue;
          if (row.status === "posted" || row.status === "inbound") posted += n;
          else if (row.status === "failed") failed = n;
        }
        bridgePosts = { posted, failed };
      }
      return {
        status: !configured ? "empty" : !hasWebhook ? "setup_required" : "live",
        orgId,
        configured,
        platformConfigured: setup.configured,
        inboundReady,
        canPost: hasWebhook && (connection?.enabled ?? false),
        setupRequired: !hasWebhook,
        message: !configured
          ? "Link a Slack channel webhook so team chat and Slack stay in sync."
          : !hasWebhook
            ? "Paste a valid Slack incoming webhook URL to finish setup."
            : setup.message,
        channelLabel: connection?.channelLabel ?? null,
        enabled: connection?.enabled ?? false,
        updatedAt: connection?.updatedAt ?? null,
        workspaceId: connection?.workspaceId ?? null,
        workspaceName: connection?.workspaceName ?? null,
        channelId: connection?.channelId ?? null,
        chatBridgeEnabled: connection?.chatBridgeEnabled ?? false,
        hasWebhook,
        hasSigningSecret: connection?.hasSigningSecret ?? false,
        empty: !configured,
        emptyReason: configured ? null : "No Slack channel linked yet.",
        bridgePosts,
        bridgePostLabel: formatSlackBridgePostCount(bridgePosts),
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
      action?: "save" | "disconnect" | "test" | "set-bridge";
      webhookUrl?: string;
      signingSecret?: string;
      channelLabel?: string;
      enabled?: boolean;
      workspaceId?: string;
      workspaceName?: string;
      channelId?: string;
      chatBridgeEnabled?: boolean;
    };
    if (!body.orgId) throw new Error("orgId is required");
    const orgId = body.orgId;
    const action = body.action ?? "save";

    const result = await withRls({ userId: current.user.id, orgId }, async (client) => {
      await assertAdmin(client, orgId, current.user.id);

      if (action === "disconnect") {
        await client.query(`DELETE FROM team_slack WHERE org_id=$1`, [orgId]);
        return { disconnected: true };
      }

      if (action === "set-bridge") {
        const existing = await client.query(`SELECT 1 FROM team_slack WHERE org_id=$1`, [orgId]);
        if (!existing.rowCount) throw new Error("Connect Slack before enabling the chat bridge");
        await client.query(
          `UPDATE team_slack SET chat_bridge_enabled=$2, updated_by=$3, updated_at=now() WHERE org_id=$1`,
          [orgId, Boolean(body.chatBridgeEnabled), current.user.id],
        );
        return { chatBridgeEnabled: Boolean(body.chatBridgeEnabled) };
      }

      if (action === "save") {
        const workspaceId = body.workspaceId?.trim() || null;
        const channelId = body.channelId?.trim() || null;
        if (workspaceId && !isValidSlackWorkspaceId(workspaceId)) {
          throw new Error("Workspace id must look like T012ABCDEF");
        }
        if (channelId && !isValidSlackChannelId(channelId)) {
          throw new Error("Channel id must look like C012ABCDEF");
        }
        const existing = await client.query<{ webhookUrl: string | null; signingSecret: string | null }>(
          `SELECT webhook_url AS "webhookUrl", signing_secret AS "signingSecret" FROM team_slack WHERE org_id=$1`,
          [orgId],
        );
        let webhookUrl: string | null = existing.rows[0]?.webhookUrl ?? null;
        if (body.webhookUrl === "") webhookUrl = null;
        else if (body.webhookUrl?.trim()) {
          webhookUrl = body.webhookUrl.trim();
          if (!isValidSlackWebhook(webhookUrl)) {
            throw new Error("Enter a Slack incoming webhook URL (hooks.slack.com/services/…)");
          }
        }
        if (!webhookUrl) throw new Error("Provide a Slack incoming webhook URL");

        let signingSecret: string | null = existing.rows[0]?.signingSecret ?? null;
        if (body.signingSecret === "") signingSecret = null;
        else if (body.signingSecret?.trim()) signingSecret = body.signingSecret.trim();

        await client.query(
          `INSERT INTO team_slack(
             org_id, webhook_url, signing_secret, workspace_id, workspace_name,
             channel_id, channel_label, enabled, chat_bridge_enabled, updated_by, updated_at
           )
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now())
           ON CONFLICT(org_id) DO UPDATE SET
             webhook_url=excluded.webhook_url,
             signing_secret=excluded.signing_secret,
             workspace_id=excluded.workspace_id,
             workspace_name=excluded.workspace_name,
             channel_id=excluded.channel_id,
             channel_label=excluded.channel_label,
             enabled=excluded.enabled,
             chat_bridge_enabled=excluded.chat_bridge_enabled,
             updated_by=excluded.updated_by,
             updated_at=now()`,
          [
            orgId,
            webhookUrl,
            signingSecret,
            workspaceId,
            body.workspaceName?.trim() || null,
            channelId,
            body.channelLabel?.trim() || null,
            body.enabled ?? true,
            body.chatBridgeEnabled ?? false,
            current.user.id,
          ],
        );
        return { saved: true };
      }

      if (action === "test") {
        const row = await client.query<{ webhookUrl: string | null; enabled: boolean }>(
          `SELECT webhook_url AS "webhookUrl", enabled FROM team_slack WHERE org_id=$1`,
          [orgId],
        );
        if (!row.rowCount) throw new Error("Connect Slack first");
        if (!row.rows[0]!.enabled) throw new Error("Slack posting is turned off for this team");
        const webhookUrl = row.rows[0]!.webhookUrl;
        if (!webhookUrl || !isValidSlackWebhook(webhookUrl)) {
          throw new Error("A valid Slack webhook is required");
        }
        const post = await postToSlackWebhook(
          webhookUrl,
          "*Vantage* connected. Team chat messages will appear here when the bridge is on.",
        );
        if (!post.ok) throw new Error(post.error ?? "Slack rejected the message");
        return { posted: true };
      }

      throw new Error("Unknown Slack action");
    });
    return Response.json({ success: true, ...result });
  } catch (error) {
    return fail(error);
  }
}
