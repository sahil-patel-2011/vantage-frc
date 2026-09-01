/**
 * Loader for the platform-admin integration health surface.
 *
 * Every query here is read-only, cheap (single-row / small aggregate, no loops), and
 * runs on the already-open RLS request client the route handler obtained after
 * `assertPlatformAdmin`. This file never calls an external provider over the network —
 * live signals come only from data already persisted by cron/worker jobs (TBA/Statbotics
 * health tables, Nexus snapshot cache, provider-key `last_used_at`, bridge
 * `health_verified_at`). Configuration-only signals come from `process.env` presence
 * checks and the setupStatus helpers each feature already ships.
 */
import type { PoolClient, QueryResultRow } from "@neondatabase/serverless";
import { emailNotificationsSetupStatus } from "@vantage/core";
import { onshapeSetupStatus } from "@vantage/cad";
import {
  getSponsoredPoolStatus,
  readAnthropicPlatformKey,
  readOpenRouterApiKey,
} from "@vantage/agent";
import { loadDataSourceHealth } from "../reference-health";
import { aiKeysEncryptionStatus } from "../ai-keys/kms-status";
import { stripeWiringSnapshot } from "../admin-org-plans";
import { pushSetupStatus } from "../push/vapid";
import { phoneOtpSetupStatus } from "../account/phone-otp";
import { githubSetupStatus } from "../github/oauth";
import { slackSetupStatus } from "../slack";
import { discordSetupStatus } from "../discord";
import {
  buildIntegrationHealthReport,
  serializeIntegrationHealthReport,
  type AiBridgeConnectorSignal,
  type AiProviderKeySignal,
} from "./integration-health";

function envFlag(env: NodeJS.ProcessEnv, ...names: string[]): boolean {
  return names.every((name) => Boolean(env[name]?.trim()));
}

/** OR-match across accepted aliases, e.g. DATABASE_ADMIN_URL / DATABASE_URL_UNPOOLED. */
function anyEnvFlag(env: NodeJS.ProcessEnv, ...names: string[]): boolean {
  return names.some((name) => Boolean(env[name]?.trim()));
}

async function safeQuery<T extends QueryResultRow>(
  client: PoolClient,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  try {
    return (await client.query<T>(sql, params)).rows;
  } catch {
    // A missing/renamed table on an older schema degrades to "no signal" rather than a crash.
    return [];
  }
}

export async function loadIntegrationHealth(
  client: PoolClient,
  env: NodeJS.ProcessEnv = process.env,
  now: Date = new Date(),
) {
  const [dbOk, referenceHealth, tbaCredentialRows, nexusRows, providerKeyRows, connectorRows, pricedPlanRows] =
    await Promise.all([
      client
        .query("SELECT 1 AS ok")
        .then((result) => result.rows[0]?.ok === 1)
        .catch(() => false),
      loadDataSourceHealth(client, null),
      safeQuery<{ count: number }>(
        client,
        `SELECT count(*)::int AS count FROM data_source_credentials WHERE source = 'tba' AND org_id IS NULL AND disabled_at IS NULL`,
      ),
      safeQuery<{ lastSyncedAt: string | null }>(
        client,
        `SELECT max(synced_at)::text AS "lastSyncedAt" FROM nexus_event_snapshots`,
      ),
      safeQuery<{ provider: string; lastUsedAt: string | null; disabledAt: string | null }>(
        client,
        `SELECT provider, last_used_at::text AS "lastUsedAt", disabled_at::text AS "disabledAt"
         FROM platform_provider_keys ORDER BY created_at DESC`,
      ),
      safeQuery<{ kind: string; enabled: boolean; healthVerifiedAt: string | null; approvalAcknowledged: boolean }>(
        client,
        `SELECT kind, enabled, health_verified_at::text AS "healthVerifiedAt", approval_acknowledged AS "approvalAcknowledged"
         FROM platform_connectors ORDER BY created_at DESC`,
      ),
      safeQuery<{ count: number }>(
        client,
        `SELECT count(*)::int AS count FROM pricing_plans WHERE active = true AND stripe_price_id IS NOT NULL AND btrim(stripe_price_id) <> ''`,
      ),
    ]);

  const tbaConfigured = anyEnvFlag(env, "TBA_AUTH_KEY", "TBA_API_KEY") || (tbaCredentialRows[0]?.count ?? 0) > 0;
  const push = pushSetupStatus();
  const providerKeys: AiProviderKeySignal[] = providerKeyRows.map((row) => ({
    provider: row.provider,
    lastUsedAt: row.lastUsedAt,
    disabledAt: row.disabledAt,
  }));
  const bridgeConnectors: AiBridgeConnectorSignal[] = connectorRows.map((row) => ({
    kind: row.kind,
    enabled: row.enabled,
    healthVerifiedAt: row.healthVerifiedAt,
    approvalAcknowledged: row.approvalAcknowledged,
  }));
  const sponsoredPool = getSponsoredPoolStatus(env);

  const report = buildIntegrationHealthReport({
    now,
    db: {
      requestRoleOk: dbOk,
      workerRoleConfigured: anyEnvFlag(env, "DATABASE_ADMIN_URL", "DATABASE_URL_UNPOOLED", "POSTGRES_URL_NON_POOLING"),
    },
    auth: {
      betterAuthConfigured: envFlag(env, "BETTER_AUTH_SECRET", "BETTER_AUTH_URL"),
      googleOAuthConfigured: envFlag(env, "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"),
      email: emailNotificationsSetupStatus(),
    },
    reference: {
      sources: referenceHealth.sources.map((source) => ({
        source: source.source,
        status: source.status,
        lastSuccessAt: source.lastSuccessAt,
        lastError: source.lastError,
      })),
      referenceMode: referenceHealth.mode,
      referenceDetail: referenceHealth.bannerDetail,
      tbaConfigured,
      nexusConfigured: anyEnvFlag(env, "NEXUS_API_KEY", "NEXUS_AUTH_KEY"),
      nexusLastSyncedAt: nexusRows[0]?.lastSyncedAt ?? null,
      firstEventsConfigured: envFlag(env, "FIRST_EVENTS_USERNAME", "FIRST_EVENTS_AUTHORIZATION_TOKEN"),
    },
    billing: {
      stripe: stripeWiringSnapshot({
        secretConfigured: envFlag(env, "STRIPE_SECRET_KEY"),
        webhookConfigured: envFlag(env, "STRIPE_WEBHOOK_SECRET"),
        billingDbConfigured: envFlag(env, "DATABASE_BILLING_URL"),
        plansWithStripePriceId: pricedPlanRows[0]?.count ?? 0,
      }),
      kms: aiKeysEncryptionStatus(),
    },
    notifications: {
      push: { ready: push.state === "ready", missing: push.state === "setup_required" ? push.missing : [] },
      phoneOtp: phoneOtpSetupStatus(),
    },
    bridges: {
      github: githubSetupStatus(env),
      slack: slackSetupStatus(),
      discord: discordSetupStatus(env),
      onshape: onshapeSetupStatus(env),
      fusionRelaySigningConfigured: envFlag(env, "FUSION_RELAY_SIGNING_SECRET"),
      cadRelayDbConfigured: envFlag(env, "DATABASE_CAD_RELAY_URL"),
    },
    ai: {
      openRouterConfigured: Boolean(readOpenRouterApiKey(env)),
      anthropicConfigured: Boolean(readAnthropicPlatformKey(env)),
      sponsoredPool: { configured: sponsoredPool.configured, degraded: sponsoredPool.degraded },
      providerKeys,
      bridgeConnectors,
      bridgeDbConfigured: envFlag(env, "DATABASE_AI_BRIDGE_URL"),
    },
    infra: {
      redisConfigured: envFlag(env, "RATE_LIMIT_REDIS_URL", "RATE_LIMIT_REDIS_TOKEN"),
      cronSecretConfigured: envFlag(env, "CRON_SECRET"),
    },
  });

  return serializeIntegrationHealthReport(report);
}
