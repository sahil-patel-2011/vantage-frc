import { describe, expect, it } from "vitest";
import {
  buildIntegrationHealthReport,
  isFreshnessStale,
  serializeIntegrationHealthReport,
  type IntegrationHealthInputs,
} from "./integration-health";

const NOW = new Date("2026-08-31T12:00:00.000Z");

/** Every-integration-configured-and-fresh baseline; individual tests mutate one slice. */
function baseInputs(): IntegrationHealthInputs {
  return {
    now: NOW,
    db: { requestRoleOk: true, workerRoleConfigured: true },
    auth: {
      betterAuthConfigured: true,
      googleOAuthConfigured: true,
      email: { status: "available", detail: "Resend is configured for transactional email." },
    },
    reference: {
      sources: [
        { source: "tba", status: "healthy", lastSuccessAt: "2026-08-31T11:00:00.000Z", lastError: null },
        { source: "statbotics", status: "healthy", lastSuccessAt: "2026-08-31T11:00:00.000Z", lastError: null },
      ],
      referenceMode: "ok",
      referenceDetail: "Reference data sources healthy.",
      tbaConfigured: true,
      nexusConfigured: true,
      nexusLastSyncedAt: "2026-08-31T11:55:00.000Z",
      firstEventsConfigured: true,
    },
    billing: {
      stripe: {
        secretConfigured: true,
        webhookConfigured: true,
        billingDbConfigured: true,
        plansWithStripePriceId: 3,
        blockers: [],
      },
      kms: { ok: true },
    },
    notifications: {
      push: { ready: true, missing: [] },
      phoneOtp: { configured: true, message: "Twilio SMS is configured for phone OTP." },
    },
    bridges: {
      github: { configured: true, message: "GitHub OAuth is configured." },
      slack: { configured: true, message: "Platform Slack signing secret is set." },
      discord: { configured: true, message: "Discord bot token is configured." },
      onshape: { configured: true, message: "Onshape OAuth client is configured." },
      fusionRelaySigningConfigured: true,
      cadRelayDbConfigured: true,
    },
    ai: {
      openRouterConfigured: true,
      anthropicConfigured: true,
      sponsoredPool: { configured: ["mistral", "groq"], degraded: [] },
      providerKeys: [{ provider: "openai", lastUsedAt: "2026-08-31T10:00:00.000Z", disabledAt: null }],
      bridgeConnectors: [
        { kind: "base44", enabled: true, healthVerifiedAt: "2026-08-31T09:00:00.000Z", approvalAcknowledged: true },
      ],
      bridgeDbConfigured: true,
    },
    infra: { redisConfigured: true, cronSecretConfigured: true },
  };
}

function findCheck(report: ReturnType<typeof buildIntegrationHealthReport>, id: string) {
  const check = report.checks.find((c) => c.id === id);
  if (!check) throw new Error(`missing check ${id}`);
  return check;
}

describe("isFreshnessStale", () => {
  it("is never stale with no observed timestamp", () => {
    expect(isFreshnessStale(null, NOW)).toBe(false);
  });

  it("is not stale just under the threshold", () => {
    const justUnder = new Date(NOW.getTime() - 5 * 60 * 60 * 1000).toISOString();
    expect(isFreshnessStale(justUnder, NOW)).toBe(false);
  });

  it("is stale just over the threshold", () => {
    const justOver = new Date(NOW.getTime() - 7 * 60 * 60 * 1000).toISOString();
    expect(isFreshnessStale(justOver, NOW)).toBe(true);
  });
});

describe("buildIntegrationHealthReport — fully configured baseline", () => {
  const report = buildIntegrationHealthReport(baseInputs());

  it("reports every category as non-setup_required", () => {
    expect(report.summary.setup_required).toBe(0);
    expect(report.summary.error).toBe(0);
  });

  it("marks the DB request role healthy with a live verification", () => {
    const check = findCheck(report, "db-request-role");
    expect(check.state).toBe("healthy");
    expect(check.verification).toBe("live");
  });

  it("marks TBA healthy with a live lastSuccessAt", () => {
    const check = findCheck(report, "reference-tba");
    expect(check.state).toBe("healthy");
    expect(check.lastSuccessAt).toBe("2026-08-31T11:00:00.000Z");
  });

  it("marks the reference ingest cron healthy when the cron secret and ingest are both fine", () => {
    const check = findCheck(report, "cron-reference-ingest");
    expect(check.state).toBe("healthy");
  });

  it("keeps Onshape, GitHub, and platform AI keys config_only even when configured", () => {
    expect(findCheck(report, "onshape-oauth").verification).toBe("config_only");
    expect(findCheck(report, "onshape-oauth").state).toBe("configured");
    expect(findCheck(report, "github-oauth").verification).toBe("config_only");
    expect(findCheck(report, "github-oauth").state).toBe("configured");
    expect(findCheck(report, "ai-openrouter").verification).toBe("config_only");
    expect(findCheck(report, "ai-anthropic").verification).toBe("config_only");
  });

  it("marks a tested admin-added AI key healthy with a live lastUsedAt signal", () => {
    const check = findCheck(report, "ai-provider-key-openai");
    expect(check.state).toBe("healthy");
    expect(check.verification).toBe("live");
    expect(check.lastSuccessAt).toBe("2026-08-31T10:00:00.000Z");
  });
});

describe("buildIntegrationHealthReport — setup_required behavior", () => {
  it("flags every unconfigured integration as setup_required, never inventing a healthy state", () => {
    const input = baseInputs();
    input.db.workerRoleConfigured = false;
    input.auth.betterAuthConfigured = false;
    input.auth.googleOAuthConfigured = false;
    input.auth.email = { status: "setup_required", detail: "Set RESEND_API_KEY and AUTH_EMAIL_FROM." };
    input.reference.tbaConfigured = false;
    input.reference.nexusConfigured = false;
    input.reference.firstEventsConfigured = false;
    input.billing.stripe = {
      secretConfigured: false,
      webhookConfigured: false,
      billingDbConfigured: false,
      plansWithStripePriceId: 0,
      blockers: ["STRIPE_SECRET_KEY is not set", "STRIPE_WEBHOOK_SECRET is not set"],
    };
    input.billing.kms = { ok: false, message: "Envelope encryption needs AWS_KMS_KEY_ID." };
    input.notifications.push = { ready: false, missing: ["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY"] };
    input.notifications.phoneOtp = { configured: false, message: "Phone OTP send needs TWILIO_* env." };
    input.bridges.github = { configured: false, message: "OAuth App not configured." };
    input.bridges.slack = { configured: false, message: "Inbound Slack events need SLACK_SIGNING_SECRET." };
    input.bridges.discord = { configured: false, message: "Set DISCORD_BOT_TOKEN." };
    input.bridges.onshape = { configured: false, message: "Setup required." };
    input.bridges.fusionRelaySigningConfigured = false;
    input.bridges.cadRelayDbConfigured = false;
    input.ai.openRouterConfigured = false;
    input.ai.anthropicConfigured = false;
    input.ai.sponsoredPool = { configured: [], degraded: [] };
    input.ai.bridgeDbConfigured = false;
    input.infra.redisConfigured = false;
    input.infra.cronSecretConfigured = false;

    const report = buildIntegrationHealthReport(input);

    for (const id of [
      "db-worker-role",
      "better-auth",
      "google-oauth",
      "resend-email",
      "reference-tba",
      "reference-nexus",
      "reference-first-events",
      "cron-secret",
      "cron-reference-ingest",
      "kms",
      "vapid-push",
      "twilio-phone-otp",
      "github-oauth",
      "slack-bridge",
      "discord-bot",
      "onshape-oauth",
      "fusion-relay",
      "ai-openrouter",
      "ai-anthropic",
      "ai-sponsored-pool",
      "ai-bridge-db",
      "redis-rate-limit",
    ]) {
      expect(findCheck(report, id).state).toBe("setup_required");
    }

    // Stripe is a config-blockers list, not a single boolean — still resolves to setup_required.
    expect(findCheck(report, "stripe").state).toBe("setup_required");

    const onshape = findCheck(report, "onshape-oauth");
    expect(onshape.verification).toBe("config_only");
    expect(onshape.remediation).toEqual({ label: "Open CAD setup", href: "/cad/setup" });
    expect(onshape.reason).not.toMatch(/sk-[A-Za-z0-9]{10,}|Bearer [A-Za-z0-9._-]{10,}/);

    const github = findCheck(report, "github-oauth");
    expect(github.verification).toBe("config_only");
    expect(github.reason).not.toMatch(/sk-[A-Za-z0-9]{10,}|Bearer [A-Za-z0-9._-]{10,}/);
  });

  it("flags missing Onshape OAuth as setup_required with a CAD setup href", () => {
    const input = baseInputs();
    input.bridges.onshape = { configured: false, message: "Setup required." };
    const report = buildIntegrationHealthReport(input);
    const check = findCheck(report, "onshape-oauth");
    expect(check.state).toBe("setup_required");
    expect(check.verification).toBe("config_only");
    expect(check.remediation).toEqual({ label: "Open CAD setup", href: "/cad/setup" });
    expect(check.reason).toBe("Setup required.");
    expect(check.reason).not.toMatch(/sk-[A-Za-z0-9]{10,}|Bearer [A-Za-z0-9._-]{10,}/);
  });

  it("keeps GitHub OAuth config_only when the OAuth App is missing", () => {
    const input = baseInputs();
    input.bridges.github = { configured: false, message: "OAuth App not configured." };
    const report = buildIntegrationHealthReport(input);
    const check = findCheck(report, "github-oauth");
    expect(check.state).toBe("setup_required");
    expect(check.verification).toBe("config_only");
    expect(check.reason).toBe("OAuth App not configured.");
  });

  it("never reports setup_required for storage — it works with zero platform config", () => {
    const report = buildIntegrationHealthReport(baseInputs());
    expect(findCheck(report, "cloud-storage").state).toBe("healthy");
    expect(findCheck(report, "storage-node").state).toBe("healthy");
  });
});

describe("buildIntegrationHealthReport — stale cron / data-source handling", () => {
  it("degrades TBA and the reference ingest cron when the last success is stale but present", () => {
    const input = baseInputs();
    const stale = new Date(NOW.getTime() - 8 * 60 * 60 * 1000).toISOString();
    input.reference.sources = [
      { source: "tba", status: "healthy", lastSuccessAt: stale, lastError: null },
      { source: "statbotics", status: "healthy", lastSuccessAt: stale, lastError: null },
    ];
    input.reference.referenceMode = "stale";
    input.reference.referenceDetail = "No recent successful TBA sync — using last-good Neon cache.";

    const report = buildIntegrationHealthReport(input);
    expect(findCheck(report, "reference-tba").state).toBe("degraded");
    expect(findCheck(report, "cron-reference-ingest").state).toBe("degraded");
  });

  it("reports error (not merely degraded) when the source is outright unavailable with no cache", () => {
    const input = baseInputs();
    input.reference.sources = [
      { source: "tba", status: "unavailable", lastSuccessAt: null, lastError: "TBA 503" },
    ];
    input.reference.referenceMode = "unavailable";
    input.reference.referenceDetail = "TBA is down and no last-good Neon cache is available yet.";

    const report = buildIntegrationHealthReport(input);
    expect(findCheck(report, "reference-tba").state).toBe("error");
    expect(findCheck(report, "cron-reference-ingest").state).toBe("error");
  });

  it("never reports a cron freshness signal when cron auth itself is unconfigured", () => {
    const input = baseInputs();
    input.infra.cronSecretConfigured = false;
    const report = buildIntegrationHealthReport(input);
    expect(findCheck(report, "cron-reference-ingest").state).toBe("setup_required");
  });

  it("degrades Nexus when configured but the snapshot cache has gone stale", () => {
    const input = baseInputs();
    input.reference.nexusLastSyncedAt = new Date(NOW.getTime() - 9 * 60 * 60 * 1000).toISOString();
    const report = buildIntegrationHealthReport(input);
    expect(findCheck(report, "reference-nexus").state).toBe("degraded");
  });
});

describe("buildIntegrationHealthReport — AI provider/bridge live signals", () => {
  it("marks an admin-added provider key configured (not healthy) until it has been tested", () => {
    const input = baseInputs();
    input.ai.providerKeys = [{ provider: "anthropic", lastUsedAt: null, disabledAt: null }];
    const report = buildIntegrationHealthReport(input);
    const check = findCheck(report, "ai-provider-key-anthropic");
    expect(check.state).toBe("configured");
    expect(check.verification).toBe("config_only");
  });

  it("marks a disabled provider key setup_required even if it was previously used", () => {
    const input = baseInputs();
    input.ai.providerKeys = [
      { provider: "openai", lastUsedAt: "2026-08-30T00:00:00.000Z", disabledAt: "2026-08-31T00:00:00.000Z" },
    ];
    const report = buildIntegrationHealthReport(input);
    expect(findCheck(report, "ai-provider-key-openai").state).toBe("setup_required");
  });

  it("marks a sponsored pool with every configured provider degraded as degraded overall", () => {
    const input = baseInputs();
    input.ai.sponsoredPool = { configured: ["mistral", "groq"], degraded: ["mistral", "groq"] };
    const report = buildIntegrationHealthReport(input);
    expect(findCheck(report, "ai-sponsored-pool").state).toBe("degraded");
  });

  it("requires written approval before an AI bridge connector can read as anything but setup_required", () => {
    const input = baseInputs();
    input.ai.bridgeConnectors = [
      { kind: "base44", enabled: false, healthVerifiedAt: null, approvalAcknowledged: false },
    ];
    const report = buildIntegrationHealthReport(input);
    expect(findCheck(report, "ai-bridge-connector-base44").state).toBe("setup_required");
  });

  it("keeps platform OpenRouter/Anthropic keys config_only when missing (never a live ping)", () => {
    const input = baseInputs();
    input.ai.openRouterConfigured = false;
    input.ai.anthropicConfigured = false;
    const report = buildIntegrationHealthReport(input);
    const openRouter = findCheck(report, "ai-openrouter");
    const anthropic = findCheck(report, "ai-anthropic");
    expect(openRouter.state).toBe("setup_required");
    expect(openRouter.verification).toBe("config_only");
    expect(anthropic.state).toBe("setup_required");
    expect(anthropic.verification).toBe("config_only");
    expect(openRouter.reason).not.toMatch(/sk-[A-Za-z0-9]{10,}|Bearer [A-Za-z0-9._-]{10,}/);
    expect(anthropic.reason).not.toMatch(/sk-[A-Za-z0-9]{10,}|Bearer [A-Za-z0-9._-]{10,}/);
  });
});

describe("serializeIntegrationHealthReport — no-secret contract", () => {
  it("only ever emits the allow-listed fields, dropping anything else attached to a check", () => {
    const report = buildIntegrationHealthReport(baseInputs());
    // Simulate a future bug that accidentally attaches a sensitive field to a check object.
    (report.checks[0] as unknown as Record<string, unknown>).apiKey = "sk-should-never-appear";
    (report.checks[0] as unknown as Record<string, unknown>).ciphertext = "deadbeef";

    const serialized = serializeIntegrationHealthReport(report);
    const json = JSON.stringify(serialized);

    expect(json).not.toContain("sk-should-never-appear");
    expect(json).not.toContain("ciphertext");
    expect(json).not.toContain("apiKey");
    for (const check of serialized.checks) {
      expect(Object.keys(check).sort()).toEqual(
        ["category", "id", "label", "lastSuccessAt", "reason", "remediation", "state", "verification"].sort(),
      );
    }
  });

  it("never lets a raw secret-shaped reason string through the classifier for any unconfigured integration", () => {
    const input = baseInputs();
    input.ai.openRouterConfigured = false;
    input.ai.anthropicConfigured = false;
    input.bridges.onshape = { configured: false, message: "Setup required." };
    input.bridges.github = { configured: false, message: "OAuth App not configured." };
    const report = buildIntegrationHealthReport(input);
    const serialized = serializeIntegrationHealthReport(report);
    const json = JSON.stringify(serialized);
    // Deliberately narrow secret-shaped patterns rather than every env var name —
    // this test locks in that classification never echoes a key/token value.
    expect(json).not.toMatch(/sk-[A-Za-z0-9]{10,}/);
    expect(json).not.toMatch(/Bearer [A-Za-z0-9._-]{10,}/);
    const onshape = serialized.checks.find((c) => c.id === "onshape-oauth");
    expect(onshape?.remediation?.href).toBe("/cad/setup");
  });

  it("produces a summary count that matches the emitted checks", () => {
    const report = buildIntegrationHealthReport(baseInputs());
    const serialized = serializeIntegrationHealthReport(report);
    const recount = { healthy: 0, configured: 0, degraded: 0, setup_required: 0, error: 0 };
    for (const check of serialized.checks) recount[check.state] += 1;
    expect(recount).toEqual(serialized.summary);
  });
});
