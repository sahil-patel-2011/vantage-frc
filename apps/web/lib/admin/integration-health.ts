/**
 * Platform-admin integration health aggregator.
 *
 * Pure classification lives here so it is fixture-testable without a database or any
 * network access — `load-integration-health.ts` does the (cheap, read-only, already
 * RLS-scoped) I/O and calls into this module. Every input this module accepts is a
 * boolean / timestamp / enum / count derived from env presence checks or already
 * redacted DB rows — never a raw key, token, or ciphertext. `serializeIntegrationHealthReport`
 * only ever emits the fields declared on `IntegrationCheck`, so nothing else can leak
 * through even if a caller passes extra fields on an input object.
 */

export type IntegrationState = "healthy" | "configured" | "degraded" | "setup_required" | "error";

/** "live" = a real DB-observed signal (health row, timestamp, count). "config_only" =
 *  only presence of required configuration was checked — nothing was verified live. */
export type IntegrationVerification = "live" | "config_only";

export type IntegrationRemediation = { label: string; href: string };

export type IntegrationCheck = {
  id: string;
  category: string;
  label: string;
  state: IntegrationState;
  verification: IntegrationVerification;
  /** Safe, human-readable reason — never includes a secret value. */
  reason: string;
  lastSuccessAt: string | null;
  remediation: IntegrationRemediation | null;
};

export type IntegrationHealthReport = {
  generatedAt: string;
  checks: IntegrationCheck[];
  summary: Record<IntegrationState, number>;
};

/** Matches the staleness convention already used by `lib/reference-health.ts`. */
export const DEFAULT_STALE_AFTER_MS = 6 * 60 * 60 * 1000;

export function isFreshnessStale(
  lastSuccessAt: string | null | undefined,
  now: Date,
  staleAfterMs: number = DEFAULT_STALE_AFTER_MS,
): boolean {
  if (!lastSuccessAt) return false;
  const parsed = Date.parse(lastSuccessAt);
  if (!Number.isFinite(parsed)) return false;
  return now.getTime() - parsed > staleAfterMs;
}

function stateFromConfig(configured: boolean): IntegrationState {
  return configured ? "configured" : "setup_required";
}

/** Combine "is it configured" with a real observed live signal into one state. */
function stateFromLive(input: { configured: boolean; erroring: boolean; stale: boolean }): IntegrationState {
  if (!input.configured) return "setup_required";
  if (input.erroring) return "error";
  if (input.stale) return "degraded";
  return "healthy";
}

export type ReferenceSourceSignal = {
  source: string;
  status: string;
  lastSuccessAt: string | null;
  lastError: string | null;
};

export type AiProviderKeySignal = {
  provider: string;
  lastUsedAt: string | null;
  disabledAt: string | null;
};

export type AiBridgeConnectorSignal = {
  kind: string;
  enabled: boolean;
  healthVerifiedAt: string | null;
  approvalAcknowledged: boolean;
};

export type IntegrationHealthInputs = {
  now?: Date;
  db: {
    /** True when the request-role client used to build this report is live (it always is —
     * we would not have reached the loader otherwise — but kept explicit for the fixture). */
    requestRoleOk: boolean;
    workerRoleConfigured: boolean;
  };
  auth: {
    betterAuthConfigured: boolean;
    googleOAuthConfigured: boolean;
    email: { status: "available" | "setup_required"; detail: string };
  };
  reference: {
    /** Already-computed TBA/Statbotics rows from `loadDataSourceHealth`. */
    sources: ReferenceSourceSignal[];
    referenceMode: "ok" | "degraded" | "unavailable" | "stale";
    referenceDetail: string;
    tbaConfigured: boolean;
    nexusConfigured: boolean;
    nexusLastSyncedAt: string | null;
    firstEventsConfigured: boolean;
  };
  billing: {
    stripe: {
      secretConfigured: boolean;
      webhookConfigured: boolean;
      billingDbConfigured: boolean;
      plansWithStripePriceId: number;
      blockers: string[];
    };
    kms: { ok: boolean; message?: string };
  };
  notifications: {
    push: { ready: boolean; missing: string[] };
    phoneOtp: { configured: boolean; message: string };
  };
  bridges: {
    github: { configured: boolean; message: string };
    slack: { configured: boolean; message: string };
    discord: { configured: boolean; message: string };
    onshape: { configured: boolean; message: string };
    fusionRelaySigningConfigured: boolean;
    cadRelayDbConfigured: boolean;
  };
  ai: {
    openRouterConfigured: boolean;
    anthropicConfigured: boolean;
    sponsoredPool: { configured: string[]; degraded: string[] };
    providerKeys: AiProviderKeySignal[];
    bridgeConnectors: AiBridgeConnectorSignal[];
    bridgeDbConfigured: boolean;
  };
  infra: {
    redisConfigured: boolean;
    cronSecretConfigured: boolean;
  };
};

function summarize(checks: IntegrationCheck[]): Record<IntegrationState, number> {
  const summary: Record<IntegrationState, number> = {
    healthy: 0,
    configured: 0,
    degraded: 0,
    setup_required: 0,
    error: 0,
  };
  for (const check of checks) summary[check.state] += 1;
  return summary;
}

/**
 * Pure builder — given already-collected safe signals, return the full report.
 * No I/O, no env reads, no secrets in or out. Deterministic given `now`.
 */
export function buildIntegrationHealthReport(input: IntegrationHealthInputs): IntegrationHealthReport {
  const now = input.now ?? new Date();
  const checks: IntegrationCheck[] = [];

  // ---- Database ----
  checks.push({
    id: "db-request-role",
    category: "Database",
    label: "Postgres request role (RLS)",
    state: input.db.requestRoleOk ? "healthy" : "error",
    verification: "live",
    reason: input.db.requestRoleOk
      ? "Connected via the pooled request role (vantage_app / withRls)."
      : "The RLS-scoped request role did not respond.",
    lastSuccessAt: input.db.requestRoleOk ? now.toISOString() : null,
    remediation: input.db.requestRoleOk
      ? null
      : { label: "Check DATABASE_URL / DATABASE_AUTH_URL", href: "/admin" },
  });
  checks.push({
    id: "db-worker-role",
    category: "Database",
    label: "Postgres worker role (migrations & cron)",
    state: stateFromConfig(input.db.workerRoleConfigured),
    verification: "config_only",
    reason: input.db.workerRoleConfigured
      ? "DATABASE_ADMIN_URL is set (vantage_worker, unpooled)."
      : "DATABASE_ADMIN_URL is not set — migrations and cron/worker ingest cannot run.",
    lastSuccessAt: null,
    remediation: input.db.workerRoleConfigured
      ? null
      : { label: "Set DATABASE_ADMIN_URL", href: "/admin" },
  });

  // ---- Auth & email ----
  checks.push({
    id: "better-auth",
    category: "Auth & email",
    label: "Better Auth",
    state: stateFromConfig(input.auth.betterAuthConfigured),
    verification: "config_only",
    reason: input.auth.betterAuthConfigured
      ? "BETTER_AUTH_SECRET and BETTER_AUTH_URL are set."
      : "BETTER_AUTH_SECRET / BETTER_AUTH_URL missing — session signing and OAuth callbacks break.",
    lastSuccessAt: null,
    remediation: input.auth.betterAuthConfigured ? null : { label: "Set Better Auth env", href: "/admin" },
  });
  checks.push({
    id: "google-oauth",
    category: "Auth & email",
    label: "Google sign-in",
    state: stateFromConfig(input.auth.googleOAuthConfigured),
    verification: "config_only",
    reason: input.auth.googleOAuthConfigured
      ? "GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are set."
      : "Google sign-in button stays disabled; email OTP is the only sign-in path.",
    lastSuccessAt: null,
    remediation: input.auth.googleOAuthConfigured
      ? null
      : { label: "Set GOOGLE_CLIENT_ID / SECRET", href: "/admin" },
  });
  checks.push({
    id: "resend-email",
    category: "Auth & email",
    label: "Resend (email OTP / 2FA / invites)",
    state: input.auth.email.status === "available" ? "configured" : "setup_required",
    verification: "config_only",
    reason: input.auth.email.detail,
    lastSuccessAt: null,
    remediation:
      input.auth.email.status === "available"
        ? null
        : { label: "Set RESEND_API_KEY / AUTH_EMAIL_FROM", href: "/admin" },
  });

  // ---- Reference data (TBA / Statbotics / Nexus / FIRST) ----
  const tba = input.reference.sources.find((source) => source.source === "tba") ?? null;
  const tbaStale = isFreshnessStale(tba?.lastSuccessAt ?? null, now);
  checks.push({
    id: "reference-tba",
    category: "Reference data",
    label: "The Blue Alliance (TBA)",
    state: stateFromLive({
      configured: input.reference.tbaConfigured,
      erroring: Boolean(tba?.lastError) || (tba?.status ?? "").toLowerCase() === "unavailable",
      stale: tbaStale,
    }),
    verification: "live",
    reason: !input.reference.tbaConfigured
      ? "No TBA Read API key configured — ingest returns setup_required."
      : tba?.lastError
        ? `TBA ingest reported an error (${tba.lastError}).`
        : tbaStale
          ? "No recent successful TBA sync — dashboards may be using a stale Neon cache."
          : "TBA ingest is healthy.",
    lastSuccessAt: tba?.lastSuccessAt ?? null,
    remediation: { label: "Platform data connectors", href: "/admin/connectors" },
  });
  const statbotics = input.reference.sources.find((source) => source.source === "statbotics") ?? null;
  const statboticsStale = isFreshnessStale(statbotics?.lastSuccessAt ?? null, now);
  checks.push({
    id: "reference-statbotics",
    category: "Reference data",
    label: "Statbotics (keyless)",
    state: stateFromLive({
      configured: true,
      erroring: Boolean(statbotics?.lastError),
      stale: statboticsStale,
    }),
    verification: "live",
    reason: statbotics?.lastError
      ? `Statbotics ingest reported an error (${statbotics.lastError}).`
      : statboticsStale
        ? "No recent successful Statbotics sync — using last-good Neon cache."
        : statbotics
          ? "Statbotics ingest is healthy."
          : "No Statbotics sync observed yet (keyless — runs alongside TBA ingest).",
    lastSuccessAt: statbotics?.lastSuccessAt ?? null,
    remediation: null,
  });
  checks.push({
    id: "reference-nexus",
    category: "Reference data",
    label: "FRC Nexus (live queue/pit map)",
    state: stateFromLive({
      configured: input.reference.nexusConfigured,
      erroring: false,
      stale: isFreshnessStale(input.reference.nexusLastSyncedAt, now),
    }),
    verification: input.reference.nexusConfigured ? "live" : "config_only",
    reason: !input.reference.nexusConfigured
      ? "NEXUS_API_KEY (or NEXUS_AUTH_KEY) is not set — Nexus panels stay setup_required."
      : input.reference.nexusLastSyncedAt
        ? "Nexus event snapshot cache has synced."
        : "Nexus is configured but no event snapshot has synced yet (no active event, or first sync pending).",
    lastSuccessAt: input.reference.nexusLastSyncedAt,
    remediation: input.reference.nexusConfigured ? null : { label: "Set NEXUS_API_KEY", href: "/admin" },
  });
  checks.push({
    id: "reference-first-events",
    category: "Reference data",
    label: "FIRST Events API",
    state: stateFromConfig(input.reference.firstEventsConfigured),
    verification: "config_only",
    reason: input.reference.firstEventsConfigured
      ? "FIRST_EVENTS_USERNAME / AUTHORIZATION_TOKEN are set."
      : "FIRST_EVENTS_USERNAME / FIRST_EVENTS_AUTHORIZATION_TOKEN not set — FIRST Events enrichment is off.",
    lastSuccessAt: null,
    remediation: input.reference.firstEventsConfigured
      ? null
      : { label: "Set FIRST_EVENTS_* env", href: "/admin" },
  });

  // ---- Cron & scheduled jobs ----
  checks.push({
    id: "cron-secret",
    category: "Cron & scheduled jobs",
    label: "Cron authorization",
    state: stateFromConfig(input.infra.cronSecretConfigured),
    verification: "config_only",
    reason: input.infra.cronSecretConfigured
      ? "CRON_SECRET is set — /api/cron/* routes accept scheduled invocations."
      : "CRON_SECRET is not set — every /api/cron/* route returns 503 (no TBA sync, digests, or reminders run).",
    lastSuccessAt: null,
    remediation: input.infra.cronSecretConfigured ? null : { label: "Set CRON_SECRET", href: "/admin" },
  });
  const referenceCronState: IntegrationState =
    input.reference.referenceMode === "ok"
      ? "healthy"
      : input.reference.referenceMode === "unavailable"
        ? "error"
        : "degraded";
  checks.push({
    id: "cron-reference-ingest",
    category: "Cron & scheduled jobs",
    label: "Reference ingest cron (TBA/Statbotics)",
    state: input.infra.cronSecretConfigured ? referenceCronState : "setup_required",
    verification: "live",
    reason: input.infra.cronSecretConfigured
      ? input.reference.referenceDetail
      : "Cron authorization is not configured, so the scheduled ingest cannot run at all.",
    lastSuccessAt: tba?.lastSuccessAt ?? statbotics?.lastSuccessAt ?? null,
    remediation: { label: "Platform data connectors", href: "/admin/connectors" },
  });

  // ---- Billing & encryption ----
  checks.push({
    id: "stripe",
    category: "Billing & encryption",
    label: "Stripe billing",
    state: input.billing.stripe.blockers.length === 0 ? "healthy" : stateFromConfig(input.billing.stripe.secretConfigured),
    verification: "config_only",
    reason:
      input.billing.stripe.blockers.length === 0
        ? "Stripe secret/webhook/billing role are set and priced plans exist."
        : input.billing.stripe.blockers.join("; "),
    lastSuccessAt: null,
    remediation: { label: "Org plans & Stripe wiring", href: "/admin/plans" },
  });
  checks.push({
    id: "kms",
    category: "Billing & encryption",
    label: "Envelope encryption (KMS)",
    state: input.billing.kms.ok ? "configured" : "setup_required",
    verification: "config_only",
    reason: input.billing.kms.ok
      ? "Key management service is initialized (AWS KMS or a non-production local vault)."
      : input.billing.kms.message ?? "Envelope encryption is not configured.",
    lastSuccessAt: null,
    remediation: input.billing.kms.ok ? null : { label: "Set AWS_KMS_KEY_ID", href: "/admin/models" },
  });

  // ---- Notifications ----
  checks.push({
    id: "vapid-push",
    category: "Notifications",
    label: "Web push (VAPID)",
    state: stateFromConfig(input.notifications.push.ready),
    verification: "config_only",
    reason: input.notifications.push.ready
      ? "VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT are set."
      : `Web push is not configured (missing: ${input.notifications.push.missing.join(", ") || "VAPID keys"}). In-app notifications still work.`,
    lastSuccessAt: null,
    remediation: input.notifications.push.ready ? null : { label: "Generate VAPID keys", href: "/admin" },
  });
  checks.push({
    id: "twilio-phone-otp",
    category: "Notifications",
    label: "Twilio (phone OTP)",
    state: stateFromConfig(input.notifications.phoneOtp.configured),
    verification: "config_only",
    reason: input.notifications.phoneOtp.message,
    lastSuccessAt: null,
    remediation: input.notifications.phoneOtp.configured
      ? null
      : { label: "Set TWILIO_* env", href: "/admin" },
  });

  // ---- Team bridges ----
  checks.push({
    id: "github-oauth",
    category: "Team bridges",
    label: "GitHub OAuth",
    state: stateFromConfig(input.bridges.github.configured),
    verification: "config_only",
    reason: input.bridges.github.message,
    lastSuccessAt: null,
    remediation: input.bridges.github.configured ? null : { label: "Set GITHUB_OAUTH_* env", href: "/admin" },
  });
  checks.push({
    id: "slack-bridge",
    category: "Team bridges",
    label: "Slack (inbound events)",
    state: stateFromConfig(input.bridges.slack.configured),
    verification: "config_only",
    reason: input.bridges.slack.message,
    lastSuccessAt: null,
    remediation: input.bridges.slack.configured
      ? null
      : { label: "Set SLACK_SIGNING_SECRET", href: "/admin" },
  });
  checks.push({
    id: "discord-bot",
    category: "Team bridges",
    label: "Discord bot",
    state: stateFromConfig(input.bridges.discord.configured),
    verification: "config_only",
    reason: input.bridges.discord.message,
    lastSuccessAt: null,
    remediation: input.bridges.discord.configured
      ? null
      : { label: "Set DISCORD_BOT_TOKEN", href: "/admin" },
  });

  // ---- CAD (Onshape / Fusion) ----
  checks.push({
    id: "onshape-oauth",
    category: "CAD",
    label: "Onshape hosted OAuth",
    state: stateFromConfig(input.bridges.onshape.configured),
    verification: "config_only",
    reason: input.bridges.onshape.message,
    lastSuccessAt: null,
    remediation: input.bridges.onshape.configured
      ? null
      : { label: "Open CAD setup", href: "/cad/setup" },
  });
  checks.push({
    id: "fusion-relay",
    category: "CAD",
    label: "Fusion local relay",
    state: stateFromConfig(input.bridges.fusionRelaySigningConfigured && input.bridges.cadRelayDbConfigured),
    verification: "config_only",
    reason:
      input.bridges.fusionRelaySigningConfigured && input.bridges.cadRelayDbConfigured
        ? "FUSION_RELAY_SIGNING_SECRET is set and the CAD relay pairing role is configured."
        : "FUSION_RELAY_SIGNING_SECRET or DATABASE_CAD_RELAY_URL is missing — local Fusion relay pairing is off.",
    lastSuccessAt: null,
    remediation:
      input.bridges.fusionRelaySigningConfigured && input.bridges.cadRelayDbConfigured
        ? null
        : { label: "Set FUSION_RELAY_SIGNING_SECRET", href: "/admin" },
  });

  // ---- AI providers / bridge ----
  checks.push({
    id: "ai-openrouter",
    category: "AI",
    label: "OpenRouter (free-org router)",
    state: stateFromConfig(input.ai.openRouterConfigured),
    verification: "config_only",
    reason: input.ai.openRouterConfigured
      ? "OPENROUTER_API_KEY is set."
      : "OPENROUTER_API_KEY not set — free-org platform AI returns setup_required.",
    lastSuccessAt: null,
    remediation: { label: "Model control / provider vault", href: "/admin/models" },
  });
  checks.push({
    id: "ai-anthropic",
    category: "AI",
    label: "Anthropic (paid-org hosted)",
    state: stateFromConfig(input.ai.anthropicConfigured),
    verification: "config_only",
    reason: input.ai.anthropicConfigured
      ? "ANTHROPIC_API_KEY is set."
      : "ANTHROPIC_API_KEY not set — paid-org platform AI unavailable (teams must BYOK).",
    lastSuccessAt: null,
    remediation: { label: "Model control / provider vault", href: "/admin/models" },
  });
  checks.push({
    id: "ai-sponsored-pool",
    category: "AI",
    label: "Sponsored pool (Mistral/Cerebras/Groq/Cohere)",
    state:
      input.ai.sponsoredPool.configured.length === 0
        ? "setup_required"
        : input.ai.sponsoredPool.degraded.length >= input.ai.sponsoredPool.configured.length
          ? "degraded"
          : "configured",
    verification: "live",
    reason:
      input.ai.sponsoredPool.configured.length === 0
        ? "No sponsored-pool provider keys are set."
        : input.ai.sponsoredPool.degraded.length > 0
          ? `Configured: ${input.ai.sponsoredPool.configured.join(", ")}. Currently rate-limited/degraded: ${input.ai.sponsoredPool.degraded.join(", ")}.`
          : `Configured: ${input.ai.sponsoredPool.configured.join(", ")}.`,
    lastSuccessAt: null,
    remediation: { label: "Sponsored AI policy", href: "/admin/sponsored" },
  });
  for (const key of input.ai.providerKeys) {
    checks.push({
      id: `ai-provider-key-${key.provider}`,
      category: "AI",
      label: `Admin-added provider key: ${key.provider}`,
      state: key.disabledAt ? "setup_required" : key.lastUsedAt ? "healthy" : "configured",
      verification: key.lastUsedAt ? "live" : "config_only",
      reason: key.disabledAt
        ? "Key is disabled."
        : key.lastUsedAt
          ? `Last used/tested ${key.lastUsedAt}.`
          : "Saved but never tested — run Test in Model control.",
      lastSuccessAt: key.lastUsedAt,
      remediation: { label: "Model control / provider vault", href: "/admin/models" },
    });
  }
  checks.push({
    id: "ai-bridge-db",
    category: "AI",
    label: "AI subscription bridge (pairing role)",
    state: stateFromConfig(input.ai.bridgeDbConfigured),
    verification: "config_only",
    reason: input.ai.bridgeDbConfigured
      ? "DATABASE_AI_BRIDGE_URL is set."
      : "DATABASE_AI_BRIDGE_URL not set — bridge falls back to the CAD relay or dev app URL.",
    lastSuccessAt: null,
    remediation: null,
  });
  for (const connector of input.ai.bridgeConnectors) {
    checks.push({
      id: `ai-bridge-connector-${connector.kind}`,
      category: "AI",
      label: `AI bridge connector: ${connector.kind}`,
      state: !connector.approvalAcknowledged
        ? "setup_required"
        : connector.enabled && connector.healthVerifiedAt
          ? "healthy"
          : "configured",
      verification: connector.healthVerifiedAt ? "live" : "config_only",
      reason: !connector.approvalAcknowledged
        ? "Written approval acknowledgement is required before this bridge can be enabled."
        : connector.healthVerifiedAt
          ? `Health test passed (${connector.healthVerifiedAt}); enabled=${connector.enabled}.`
          : "Configured but not yet health-tested.",
      lastSuccessAt: connector.healthVerifiedAt,
      remediation: { label: "Model control / provider vault", href: "/admin/models" },
    });
  }

  // ---- Infrastructure ----
  checks.push({
    id: "redis-rate-limit",
    category: "Infrastructure",
    label: "Redis (rate limiting)",
    state: stateFromConfig(input.infra.redisConfigured),
    verification: "config_only",
    reason: input.infra.redisConfigured
      ? "RATE_LIMIT_REDIS_URL / TOKEN are set (Upstash-compatible)."
      : "RATE_LIMIT_REDIS_URL/TOKEN not set — rate limiting falls back to per-instance memory.",
    lastSuccessAt: null,
    remediation: input.infra.redisConfigured ? null : { label: "Set RATE_LIMIT_REDIS_*", href: "/admin" },
  });

  // ---- Storage ----
  checks.push({
    id: "cloud-storage",
    category: "Storage",
    label: "Cloud object storage (Postgres)",
    state: input.db.requestRoleOk ? "healthy" : "error",
    verification: "live",
    reason:
      "Binary uploads store as bytea rows in Postgres up to the schema/platform cap; no separate blob provider is required.",
    lastSuccessAt: null,
    remediation: null,
  });
  checks.push({
    id: "storage-node",
    category: "Storage",
    label: "Self-hosted storage node (optional)",
    state: "healthy",
    verification: "config_only",
    reason:
      "Opt-in per-team pairing under Team → Storage; no platform-wide credential is required for this feature to work.",
    lastSuccessAt: null,
    remediation: null,
  });

  return {
    generatedAt: now.toISOString(),
    checks,
    summary: summarize(checks),
  };
}

/**
 * Explicit allow-list serializer. Even if a caller accidentally attaches extra fields
 * to a check object, only these ever reach the client — the contract test in
 * integration-health.test.ts asserts no unexpected keys and no secret-shaped values.
 */
export function serializeIntegrationHealthReport(report: IntegrationHealthReport) {
  return {
    generatedAt: report.generatedAt,
    summary: report.summary,
    checks: report.checks.map((check) => ({
      id: check.id,
      category: check.category,
      label: check.label,
      state: check.state,
      verification: check.verification,
      reason: check.reason,
      lastSuccessAt: check.lastSuccessAt,
      remediation: check.remediation ? { label: check.remediation.label, href: check.remediation.href } : null,
    })),
  };
}
