/**
 * Proof-of-link for every connector, gathered on the caller's RLS client.
 *
 * "Connected" here always means a row exists that only a real successful
 * authorisation could have written. Nothing on this page is inferred from an
 * environment variable being present — a deployment with GITHUB_OAUTH_CLIENT_ID
 * set has an OAuth application, not a linked repository, and saying otherwise
 * is how a connector page becomes a page nobody trusts.
 *
 * Every query runs inside a savepoint. These tables span forty migrations and a
 * deployment mid-upgrade will be missing one of them; without a savepoint the
 * first failure aborts the request transaction and every later query returns
 * nothing, so one absent table turns into "no connector is linked" — a
 * uniformly dark page that looks like an answer and is not one. (The same
 * mistake, and the same fix, as `lib/admin/load-integration-health.ts`.)
 */
import type { PoolClient, QueryResultRow } from "@neondatabase/serverless";
import { withSavepoint } from "@vantage/db";
import { isValidDiscordWebhook } from "../discord";
import { isValidSlackWebhook } from "../slack";
import { onshapeAccountLabel } from "../cad/onshape-setup-strings";
import {
  CONNECTORS,
  describeConnector,
  type ConnectorAudience,
  type ConnectorId,
  type ConnectorLinkProof,
  type ConnectorStatus,
} from "./catalog";

async function safeRows<T extends QueryResultRow>(
  client: PoolClient,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  return withSavepoint(client, async () => (await client.query<T>(sql, params)).rows, [] as T[]);
}

export type ConnectorProofs = Partial<Record<ConnectorId, ConnectorLinkProof>>;

/**
 * Read the stored link for each connector.
 *
 * `orgId` may be null — a member with no workspace still gets an honest page,
 * it just cannot show a team-scoped link. Passing a null orgId skips the
 * org-scoped queries entirely rather than running them with a null parameter
 * and letting RLS quietly return nothing.
 */
export async function loadConnectorProofs(
  client: PoolClient,
  input: { userId: string; orgId: string | null },
): Promise<ConnectorProofs> {
  const proofs: ConnectorProofs = {};

  if (!input.orgId) {
    const note =
      "Team connectors are saved per team. Choose your team on /workspace, then come back — nothing is linked until a real row exists.";
    for (const def of CONNECTORS) {
      if (def.scope !== "platform") proofs[def.id] = { linked: false, note };
    }
    return proofs;
  }

  const orgId = input.orgId;

  const [github, onshape, discord, slack, tba, storage, relay] = await Promise.all([
    // Any non-disabled row, whatever its status: a row in `error` is a link
    // whose token GitHub refused, and reporting that as "Not connected" sends
    // the reader off to create a second OAuth App instead of reconnecting.
    safeRows<{ login: string | null; repo: string | null; status: string }>(
      client,
      `SELECT github_login AS login, default_repo_full_name AS repo, status
       FROM github_connections
       WHERE org_id=$1::uuid AND disabled_at IS NULL
       LIMIT 1`,
      [orgId],
    ),
    safeRows<{ ref: string | null; status: string }>(
      client,
      `SELECT external_account_ref AS ref, status
       FROM cad_connections
       WHERE org_id=$1::uuid AND user_id=$2::uuid AND platform='onshape'
         AND status='connected' AND disabled_at IS NULL
       LIMIT 1`,
      [orgId, input.userId],
    ),
    safeRows<{ webhookUrl: string | null; channelId: string | null; bridge: boolean }>(
      client,
      `SELECT webhook_url AS "webhookUrl", channel_id AS "channelId",
              chat_bridge_enabled AS bridge
       FROM team_discord WHERE org_id=$1::uuid LIMIT 1`,
      [orgId],
    ),
    safeRows<{ webhookUrl: string | null; bridge: boolean }>(
      client,
      `SELECT webhook_url AS "webhookUrl", chat_bridge_enabled AS bridge
       FROM team_slack WHERE org_id=$1::uuid LIMIT 1`,
      [orgId],
    ),
    safeRows<{ count: string }>(
      client,
      `SELECT count(*)::text AS count FROM data_source_credentials
       WHERE source='tba' AND disabled_at IS NULL
         AND (org_id IS NULL OR org_id = $1::uuid)`,
      [orgId],
    ),
    safeRows<{ name: string; lastHeartbeatAt: string | null }>(
      client,
      `SELECT name, last_heartbeat_at::text AS "lastHeartbeatAt"
       FROM storage_nodes
       WHERE org_id=$1::uuid AND revoked_at IS NULL
       ORDER BY last_heartbeat_at DESC NULLS LAST
       LIMIT 1`,
      [orgId],
    ),
    safeRows<{ machineName: string; lastSeenAt: string | null }>(
      client,
      `SELECT machine_name AS "machineName", last_seen_at::text AS "lastSeenAt"
       FROM cad_relay_devices
       WHERE org_id=$1::uuid AND platform='fusion360' AND revoked_at IS NULL
       ORDER BY last_seen_at DESC NULLS LAST
       LIMIT 1`,
      [orgId],
    ),
  ]);

  const githubRow = github[0];
  if (githubRow?.status === "error") {
    // `expiresAt` in the past with no refresh token is how the catalog spells
    // "this credential is dead" — GitHub OAuth Apps issue no refresh token, so
    // there is nothing to renew and only a person can fix it.
    proofs.github = {
      linked: true,
      account: githubRow.login,
      expiresAt: 1,
      refreshable: false,
      note: `GitHub refused the stored credential for @${githubRow.login ?? "this account"}. Disconnect and connect again to issue a new one.`,
    };
  } else if (githubRow?.status === "connected") {
    proofs.github = {
      linked: true,
      account: githubRow.login,
      note: githubRow.repo
        ? `The deploy log and code review read ${githubRow.repo}.`
        : "GitHub is linked, but no default repository is chosen — the deploy log and calendar milestones stay empty until one is set in Invites.",
    };
  }

  const onshapeRow = onshape[0];
  if (onshapeRow) {
    proofs.onshape = { linked: true, account: onshapeAccountLabel(onshapeRow.ref), refreshable: true };
  }

  const discordRow = discord[0];
  const discordWebhookOk = Boolean(discordRow?.webhookUrl && isValidDiscordWebhook(discordRow.webhookUrl));
  if (discordWebhookOk || discordRow?.channelId) {
    proofs.discord = {
      linked: true,
      account: discordWebhookOk ? "a channel webhook" : `channel ${discordRow!.channelId}`,
      note: discordWebhookOk
        ? `Announcements post to the saved channel webhook.${discordRow?.bridge ? " The team-chat bridge is on." : " The team-chat bridge is off — turn it on at /team/discord."}`
        : "A channel id is saved but no webhook. Add a webhook on Discord settings before posts work.",
    };
  }

  const slackRow = slack[0];
  if (slackRow?.webhookUrl && isValidSlackWebhook(slackRow.webhookUrl)) {
    proofs.slack = {
      linked: true,
      account: "an incoming webhook",
      note: slackRow.bridge
        ? "Team chat mirrors to the saved Slack webhook. Replies come back after the Slack request URL is registered."
        : "The Slack webhook is saved but the chat bridge is off — turn it on at /team/slack.",
    };
  }

  if (Number(tba[0]?.count ?? 0) > 0) {
    proofs.tba = {
      linked: true,
      account: "an encrypted team key",
      note: "A TBA Read API key is stored for this deployment, so match and ranking sync can run.",
    };
  }

  const storageRow = storage[0];
  if (storageRow) {
    proofs["storage-node"] = {
      linked: true,
      account: storageRow.name,
      note: storageRow.lastHeartbeatAt
        ? `Paired and last heard from at ${storageRow.lastHeartbeatAt}.`
        : "Paired, but it has never sent a heartbeat — check that the node agent is running on the team machine.",
    };
  }

  const relayRow = relay[0];
  if (relayRow) {
    proofs["fusion-relay"] = {
      linked: true,
      account: relayRow.machineName,
      note: relayRow.lastSeenAt
        ? `Paired and last seen at ${relayRow.lastSeenAt}. Fusion runs on that laptop; it is never driven from the cloud.`
        : "Paired, but the relay has never checked in — start the Vantage add-in inside Fusion 360 on that laptop.",
    };
  }

  const freeRelay = await safeRows<{ name: string; lastHeartbeatAt: string | null }>(
    client,
    `SELECT name, last_heartbeat_at::text AS "lastHeartbeatAt"
     FROM relay_nodes
     WHERE org_id=$1::uuid AND revoked_at IS NULL
     ORDER BY last_heartbeat_at DESC NULLS LAST
     LIMIT 1`,
    [orgId],
  );
  const freeRelayRow = freeRelay[0];
  if (freeRelayRow) {
    proofs["free-relay"] = {
      linked: true,
      account: freeRelayRow.name,
      note: freeRelayRow.lastHeartbeatAt
        ? `Paired and last heard from at ${freeRelayRow.lastHeartbeatAt}.`
        : "Paired, but it has never sent a heartbeat — start the Pi relay.",
    };
  }

  return proofs;
}

/** Every connector's card, in catalog order. */
export function buildConnectorStatuses(
  env: Record<string, string | undefined>,
  proofs: ConnectorProofs,
  audience: ConnectorAudience = "operator",
): ConnectorStatus[] {
  return CONNECTORS.map((def) => describeConnector(def, env, proofs[def.id] ?? {}, audience));
}

/** One line for the page header: "3 connected · 2 need setup". Never a fake total. */
export function summarizeConnectors(statuses: readonly ConnectorStatus[]): string {
  const connected = statuses.filter((s) => s.state === "connected").length;
  const needsEnv = statuses.filter((s) => s.state === "not_configured").length;
  const expired = statuses.filter((s) => s.state === "token_expired").length;
  const parts = [`${connected} connected`];
  if (needsEnv > 0) parts.push(`${needsEnv} need${needsEnv === 1 ? "s" : ""} setup`);
  if (expired > 0) parts.push(`${expired} expired`);
  return parts.join(" · ");
}
