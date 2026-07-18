import {
  auth,
  emailNotificationsSetupStatus,
  getUserEmailPreferences,
  mergeInAppNotificationPrefs,
  updateUserEmailPreferences,
  type InAppNotificationPrefs,
  type UserEmailPreferences,
} from "@vantage/core";
import { onshapeSetupStatus } from "@vantage/cad";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { z } from "zod";
import type { ConnectionConnectorStatus } from "../../../lib/account/connections-related";
import { canPostViaDiscord } from "../../../lib/discord-related";
import { discordSetupStatus, isValidDiscordWebhook } from "../../../lib/discord";
import { githubSetupStatus, loadGitHubConnection } from "../../../lib/github";
import { resolveTbaConfigured } from "../../../lib/reference/tba-access";

const prefsSchema = z.object({
  matchAlerts: z.boolean().optional(),
  scoutReminders: z.boolean().optional(),
  syncFailures: z.boolean().optional(),
  productUpdates: z.boolean().optional(),
  todoAssigned: z.boolean().optional(),
  todoCompleted: z.boolean().optional(),
  dutyAssigned: z.boolean().optional(),
  calendarEvents: z.boolean().optional(),
  sponsorReminders: z.boolean().optional(),
});

const emailPrefsSchema = z.object({
  productUpdates: z.boolean().optional(),
  coachAssignments: z.boolean().optional(),
  coachTodos: z.boolean().optional(),
  coachPracticeReminders: z.boolean().optional(),
  sponsorReminders: z.boolean().optional(),
});

const putSchema = z.object({
  displayName: z.string().trim().min(1).max(80).optional(),
  notificationPrefs: prefsSchema.optional(),
  emailPrefs: emailPrefsSchema.optional(),
});

export type NotificationPrefs = InAppNotificationPrefs;

function mergePrefs(raw: unknown): NotificationPrefs {
  return mergeInAppNotificationPrefs(raw);
}

async function currentSession() {
  return auth.api.getSession({ headers: await headers() });
}

type OrgConnectorSnapshot = {
  orgId: string | null;
  onshapeConnected: boolean;
  discordHasWebhook: boolean;
  discordChannelId: string | null;
  discordChatBridgeEnabled: boolean;
  githubConnected: boolean;
};

async function resolveMembershipOrgId(
  client: import("@neondatabase/serverless").PoolClient,
  userId: string,
): Promise<string | null> {
  const membership = await client.query<{ orgId: string }>(
    `SELECT m.org_id AS "orgId"
     FROM memberships m
     WHERE m.user_id=$1::uuid
     ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, m.created_at ASC
     LIMIT 1`,
    [userId],
  );
  return membership.rows[0]?.orgId ?? null;
}

/** Org-scoped connector proof — requires withRls({ userId, orgId }). Never invents Connected. */
async function loadOrgConnectorSnapshot(
  client: import("@neondatabase/serverless").PoolClient,
  orgId: string,
  userId: string,
): Promise<OrgConnectorSnapshot> {
  const onshape = await client.query<{ id: string }>(
    `SELECT id FROM cad_connections
     WHERE org_id=$1::uuid AND user_id=$2::uuid AND platform='onshape'
       AND status='connected' AND disabled_at IS NULL
     LIMIT 1`,
    [orgId, userId],
  );

  let discordHasWebhook = false;
  let discordChannelId: string | null = null;
  let discordChatBridgeEnabled = false;
  try {
    const discord = await client.query<{
      webhookUrl: string | null;
      channelId: string | null;
      chatBridgeEnabled: boolean;
    }>(
      `SELECT webhook_url AS "webhookUrl", channel_id AS "channelId",
              chat_bridge_enabled AS "chatBridgeEnabled"
       FROM team_discord WHERE org_id=$1::uuid LIMIT 1`,
      [orgId],
    );
    const row = discord.rows[0];
    if (row) {
      discordHasWebhook = Boolean(row.webhookUrl && isValidDiscordWebhook(row.webhookUrl));
      discordChannelId = row.channelId;
      discordChatBridgeEnabled = Boolean(row.chatBridgeEnabled);
    }
  } catch {
    // team_discord may be mid-migration — stay empty, never invent Connected.
  }

  const github = await loadGitHubConnection(client, orgId);

  return {
    orgId,
    onshapeConnected: Boolean(onshape.rows[0]?.id),
    discordHasWebhook,
    discordChannelId,
    discordChatBridgeEnabled,
    githubConnected: Boolean(github && github.status === "connected"),
  };
}

function onshapeIntegration(
  orgId: string | null,
  connected: boolean,
): { status: ConnectionConnectorStatus; detail: string; platformConfigured: boolean; connected: boolean } {
  const setup = onshapeSetupStatus();
  if (!setup.configured) {
    return {
      status: "setup_required",
      detail: setup.message,
      platformConfigured: false,
      connected: false,
    };
  }
  if (connected) {
    return {
      status: "connected",
      detail: "Onshape OAuth is linked for your account in this workspace.",
      platformConfigured: true,
      connected: true,
    };
  }
  if (!orgId) {
    return {
      status: "available",
      detail: "Onshape OAuth client is configured. Select a workspace, then authorize in CAD Connections.",
      platformConfigured: true,
      connected: false,
    };
  }
  return {
    status: "empty",
    detail: "OAuth client is ready — authorize in CAD Connections. Connected only after a real OAuth row.",
    platformConfigured: true,
    connected: false,
  };
}

function discordIntegration(
  orgId: string | null,
  snapshot: OrgConnectorSnapshot,
): {
  status: ConnectionConnectorStatus;
  detail: string;
  platformConfigured: boolean;
  canPost: boolean;
} {
  const setup = discordSetupStatus();
  const canPost = canPostViaDiscord({
    hasWebhook: snapshot.discordHasWebhook,
    channelId: snapshot.discordChannelId,
    platformConfigured: setup.configured,
  });

  if (canPost) {
    return {
      status: "connected",
      detail: snapshot.discordHasWebhook
        ? "Discord webhook (or bot + channel) can post for this workspace."
        : "Discord bot + channel id can post for this workspace.",
      platformConfigured: setup.configured,
      canPost: true,
    };
  }

  if (!orgId) {
    return {
      status: setup.configured ? "available" : "setup_required",
      detail: setup.configured
        ? "Discord bot token is on this deployment. Select a workspace to add a webhook or channel."
        : "Select a workspace, then add a channel webhook (bot token optional) on Discord settings.",
      platformConfigured: setup.configured,
      canPost: false,
    };
  }

  if (!snapshot.discordHasWebhook && !setup.configured) {
    return {
      status: "setup_required",
      detail:
        "Add a Discord channel webhook on Team → Discord, or set DISCORD_BOT_TOKEN for bot posts. Never shows Connected until one path works.",
      platformConfigured: false,
      canPost: false,
    };
  }

  return {
    status: "empty",
    detail: setup.configured
      ? "Bot token is configured — add a webhook or channel id on Discord settings before posts work."
      : "Webhook not saved for this workspace yet. Connected only after a valid webhook or bot+channel.",
    platformConfigured: setup.configured,
    canPost: false,
  };
}

function githubIntegration(
  orgId: string | null,
  connected: boolean,
): {
  status: ConnectionConnectorStatus;
  detail: string;
  oauthConfigured: boolean;
  connected: boolean;
} {
  const setup = githubSetupStatus();
  if (connected) {
    return {
      status: "connected",
      detail: "GitHub is linked for this workspace (OAuth or encrypted PAT).",
      oauthConfigured: setup.configured,
      connected: true,
    };
  }
  if (!orgId) {
    return {
      status: "available",
      detail: setup.message,
      oauthConfigured: setup.configured,
      connected: false,
    };
  }
  return {
    status: "empty",
    detail: setup.configured
      ? "No GitHub account linked yet. Owners/admins can Connect GitHub (OAuth) or save a PAT in Team admin."
      : "No GitHub link yet. Save an encrypted PAT in Team admin (OAuth App credentials are optional on this deployment).",
    oauthConfigured: setup.configured,
    connected: false,
  };
}

export async function GET() {
  const session = await currentSession();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const profile = await withRls({ userId: session.user.id }, async (client) => {
      const result = await client.query<{
        displayName: string | null;
        notificationPrefs: unknown;
        themePreference: string;
      }>(
        `SELECT display_name AS "displayName",
                notification_prefs AS "notificationPrefs",
                theme_preference AS "themePreference"
         FROM profiles WHERE user_id=$1`,
        [session.user.id],
      );
      const unread = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM notifications
         WHERE user_id=$1 AND read_at IS NULL`,
        [session.user.id],
      );
      const emailPrefs = await getUserEmailPreferences(client, session.user.id);
      const tba = await resolveTbaConfigured(client, null);
      const membershipOrgId = await resolveMembershipOrgId(client, session.user.id);
      return {
        row: result.rows[0] ?? null,
        unreadCount: Number(unread.rows[0]?.count ?? 0),
        emailPrefs,
        tba,
        membershipOrgId,
      };
    });

    const emptyConnectors: OrgConnectorSnapshot = {
      orgId: profile.membershipOrgId,
      onshapeConnected: false,
      discordHasWebhook: false,
      discordChannelId: null,
      discordChatBridgeEnabled: false,
      githubConnected: false,
    };
    const orgConnectors =
      profile.membershipOrgId != null
        ? await withRls({ userId: session.user.id, orgId: profile.membershipOrgId }, (client) =>
            loadOrgConnectorSnapshot(client, profile.membershipOrgId!, session.user.id),
          )
        : emptyConnectors;

    const tbaReady = profile.tba.platformEnvKey || profile.tba.credentialAvailable;
    const orgId = orgConnectors.orgId;
    const googleConfigured = Boolean(
      process.env["GOOGLE_CLIENT_ID"]?.trim() && process.env["GOOGLE_CLIENT_SECRET"]?.trim(),
    );

    const onshape = onshapeIntegration(orgId, orgConnectors.onshapeConnected);
    const discord = discordIntegration(orgId, orgConnectors);
    const github = githubIntegration(orgId, orgConnectors.githubConnected);

    return Response.json({
      name: session.user.name,
      email: session.user.email,
      image: session.user.image,
      displayName: profile.row?.displayName ?? session.user.name ?? null,
      themePreference: profile.row?.themePreference === "dark" ? "dark" : "light",
      notificationPrefs: mergePrefs(profile.row?.notificationPrefs),
      emailPrefs: profile.emailPrefs,
      emailDelivery: emailNotificationsSetupStatus(),
      unreadNotificationCount: profile.unreadCount,
      // Never invent DEMO Google Connected — deployment OAuth readiness only.
      googleConnected: false,
      tbaConfigured: profile.tba.tbaConfigured,
      integrations: {
        google: {
          status: googleConfigured ? ("available" as const) : ("setup_required" as const),
          detail: googleConfigured
            ? "Google sign-in is configured for this deployment."
            : "GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set on this deployment.",
        },
        tba: {
          status: tbaReady || profile.tba.cacheHasSync ? ("available" as const) : ("setup_required" as const),
          detail: tbaReady
            ? "Platform TBA Read API key (env or encrypted credential) is configured for reference ingest."
            : profile.tba.cacheHasSync
              ? "Neon TBA cache has prior sync data; configure TBA_AUTH_KEY or a connector to refresh."
              : "Set TBA_AUTH_KEY (or TBA_API_KEY) or save a TBA credential in Admin → Live Data.",
        },
        onshape,
        discord,
        github,
      },
    });
  } catch {
    return Response.json({ error: "Could not load account settings." }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const session = await currentSession();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = putSchema.safeParse(await request.json());
  if (!body.success) {
    return Response.json({ error: "Invalid account update." }, { status: 400 });
  }

  try {
    const updated = await withRls({ userId: session.user.id }, async (client) => {
      const existing = await client.query<{ notificationPrefs: unknown; displayName: string | null }>(
        `SELECT notification_prefs AS "notificationPrefs", display_name AS "displayName"
         FROM profiles WHERE user_id=$1`,
        [session.user.id],
      );
      const nextPrefs = body.data.notificationPrefs
        ? { ...mergePrefs(existing.rows[0]?.notificationPrefs), ...body.data.notificationPrefs }
        : mergePrefs(existing.rows[0]?.notificationPrefs);
      const displayName = body.data.displayName ?? existing.rows[0]?.displayName ?? session.user.name ?? null;

      await client.query(
        `INSERT INTO profiles(user_id, display_name, notification_prefs)
         VALUES($1,$2,$3::jsonb)
         ON CONFLICT(user_id) DO UPDATE SET
           display_name = COALESCE(excluded.display_name, profiles.display_name),
           notification_prefs = excluded.notification_prefs`,
        [session.user.id, displayName, JSON.stringify(nextPrefs)],
      );

      if (body.data.displayName) {
        await client.query(`UPDATE users SET name=$2 WHERE id=$1`, [session.user.id, body.data.displayName]);
      }

      let emailPrefs: UserEmailPreferences | undefined;
      if (body.data.emailPrefs) {
        emailPrefs = await updateUserEmailPreferences(client, session.user.id, body.data.emailPrefs);
      } else {
        emailPrefs = await getUserEmailPreferences(client, session.user.id);
      }

      return { displayName, notificationPrefs: nextPrefs, emailPrefs };
    });

    return Response.json({ ok: true, ...updated });
  } catch {
    return Response.json({ error: "Could not save account settings." }, { status: 500 });
  }
}
