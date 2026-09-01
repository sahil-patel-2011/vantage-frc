import { isOnshapeOAuthConfigured, readOnshapeApiKeys } from "@vantage/cad";
import { hostedOnshapeAgentAuth, hostedOnshapeEnvAuth } from "./hosted-auth";

/**
 * Honest hosted-Onshape setup copy for CAD Connections / Setup.
 *
 * Hosted ready = Onshape OAuth tokens in cad_connections. Server API keys
 * are CLI last-resort only and are never a hosted success state. The local
 * Playwright path (`vantage-cad login`) stays available either way. Nothing
 * here invents documents, STL/STEP/GLTF exports, or live geometry.
 */

export const ONSHAPE_HOSTED_UNCONFIGURED_TITLE = "Hosted Onshape is not configured";

export const ONSHAPE_LOCAL_PLAYWRIGHT_HINT =
  "The local path still works: run `vantage-cad login` and use the CAD tools through the Playwright Onshape window without API keys.";

export const ONSHAPE_NO_INVENTED_EXPORTS =
  "Vantage does not invent Onshape documents or STL/STEP/GLTF exports. Those appear only after a real connected run.";

export const ONSHAPE_PLATFORM_HINT_UNCONFIGURED =
  "Run `vantage-cad login` for the local Playwright path (no API keys). Hosted CAD needs Onshape OAuth — server keys are not a hosted connection.";

export const ONSHAPE_PLATFORM_HINT_CONFIGURED =
  "Connect Onshape OAuth in CAD Connections for hosted jobs. On a laptop, `vantage-cad login` uses the local Playwright window without API keys.";

export const ONSHAPE_HOSTED_BADGE = {
  connected: "Connected",
  oauthReady: "OAuth ready",
  adminSetup: "Admin setup",
} as const;

export const ONSHAPE_OAUTH_CTA = {
  connect: "Connect Onshape OAuth",
  reconnect: "Reconnect Onshape OAuth",
  disabledTitle: "Configure Onshape OAuth environment credentials first",
  disabledDetail:
    "Setup required — admin must set ONSHAPE_OAUTH_CLIENT_ID and ONSHAPE_OAUTH_CLIENT_SECRET on Vercel, then redeploy.",
} as const;

export type OnshapeHostedReason = "missing_env" | "missing_session" | "oauth_ready" | "connected";

export type OnshapeHostedSetup = {
  configured: boolean;
  setupRequired: boolean;
  status: "setup_required" | "ready";
  reason: OnshapeHostedReason;
  message: string;
  bannerTitle: string;
  /** Always true — local Playwright does not need hosted env. */
  localPlaywrightAvailable: true;
  connectCtaEnabled: boolean;
};

export type HostedOnshapeFlags = {
  oauthConfigured: boolean;
  apiKeyConfigured: boolean;
  sessionConnected?: boolean;
};

const MISSING_ENV_MESSAGE =
  "Setup required — set ONSHAPE_OAUTH_CLIENT_ID and ONSHAPE_OAUTH_CLIENT_SECRET on the server. Server API keys are CLI last-resort only and do not connect hosted CAD.";

const MISSING_SESSION_MESSAGE =
  "Setup required — connect Onshape OAuth in CAD Connections before hosted CAD can edit a Part Studio.";

const OAUTH_READY_MESSAGE =
  "Onshape OAuth client is configured. Users can connect in CAD Connections. Hosted calls spend the annual API allowance.";

const CONNECTED_MESSAGE = "Onshape is connected for this team member.";

function ready(reason: Exclude<OnshapeHostedReason, "missing_env" | "missing_session">, message: string): OnshapeHostedSetup {
  return {
    configured: true,
    setupRequired: false,
    status: "ready",
    reason,
    message,
    bannerTitle: "",
    localPlaywrightAvailable: true,
    connectCtaEnabled: reason === "oauth_ready" || reason === "connected",
  };
}

function blocked(reason: "missing_env" | "missing_session", message: string, connectCtaEnabled: boolean): OnshapeHostedSetup {
  return {
    configured: reason === "missing_session",
    setupRequired: true,
    status: "setup_required",
    reason,
    message: `${message} ${ONSHAPE_LOCAL_PLAYWRIGHT_HINT}`,
    bannerTitle: reason === "missing_env" ? ONSHAPE_HOSTED_UNCONFIGURED_TITLE : "Connect Onshape OAuth",
    localPlaywrightAvailable: true,
    connectCtaEnabled,
  };
}

/** Env-level hosted status: OAuth client present → ready. Keys-only → setup_required. */
export function hostedOnshapeSetup(flags: HostedOnshapeFlags): OnshapeHostedSetup {
  const auth = hostedOnshapeEnvAuth(flags);
  if (!auth.setupRequired) {
    return ready("oauth_ready", OAUTH_READY_MESSAGE);
  }
  return blocked("missing_env", MISSING_ENV_MESSAGE, false);
}

/**
 * What the hosted CAD agent / token loader can actually run.
 * Ready only with OAuth env + a cad_connections session. Keys-only is setup_required.
 */
export function hostedOnshapeAgentStatus(flags: Required<HostedOnshapeFlags>): OnshapeHostedSetup {
  const auth = hostedOnshapeAgentAuth(flags);
  if (auth.connected) {
    return ready("connected", CONNECTED_MESSAGE);
  }
  if (auth.reason === "missing_session") {
    return blocked("missing_session", MISSING_SESSION_MESSAGE, true);
  }
  return blocked("missing_env", MISSING_ENV_MESSAGE, false);
}

export function hostedOnshapeEnvStatus(env: NodeJS.ProcessEnv = process.env): OnshapeHostedSetup {
  return hostedOnshapeSetup({
    oauthConfigured: isOnshapeOAuthConfigured(env),
    apiKeyConfigured: Boolean(readOnshapeApiKeys(env)),
  });
}

export function onshapeHostedBadge(input: {
  sessionConnected: boolean;
  oauthCtaEnabled: boolean;
}): { label: string; kind: "connected" | "oauth_ready" | "admin_setup" } {
  if (input.sessionConnected) return { label: ONSHAPE_HOSTED_BADGE.connected, kind: "connected" };
  if (input.oauthCtaEnabled) return { label: ONSHAPE_HOSTED_BADGE.oauthReady, kind: "oauth_ready" };
  return { label: ONSHAPE_HOSTED_BADGE.adminSetup, kind: "admin_setup" };
}

/** Enable the Connect OAuth button only when the OAuth client env is actually present. */
export function onshapeOauthCtaEnabled(onshape: {
  configured?: boolean;
  redirectUri?: string | null;
  scopes?: unknown[] | null;
} | null | undefined): boolean {
  if (!onshape) return false;
  if (typeof onshape.redirectUri === "string" && onshape.redirectUri.trim()) return true;
  return Boolean(onshape.configured && Array.isArray(onshape.scopes) && onshape.scopes.length > 0);
}

export function withLocalPlaywrightHint(message: string): string {
  const trimmed = message.trim();
  if (!trimmed) return ONSHAPE_LOCAL_PLAYWRIGHT_HINT;
  if (/vantage-cad login|Playwright/i.test(trimmed)) return trimmed;
  return `${trimmed} ${ONSHAPE_LOCAL_PLAYWRIGHT_HINT}`;
}
