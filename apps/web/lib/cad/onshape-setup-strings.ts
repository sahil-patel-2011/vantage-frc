/**
 * Hosted-Onshape setup copy that is safe to import from a Client Component.
 *
 * Nothing here may import `@vantage/cad` or `./hosted-auth`. Both reach
 * `@vantage/agent`, whose web tools use `dns`, `net`, `tls` and `fs` — Node
 * built-ins the browser bundle cannot resolve. When the CAD Setup and
 * Connections clients imported the copy module directly, that graph was pulled
 * into the client bundle and every production build failed with
 * "Module not found: Can't resolve 'dns'".
 *
 * The env-reading half lives in `./onshape-setup-copy`, which re-exports this
 * file so server callers keep one import.
 *
 * Hosted ready = Onshape OAuth tokens in cad_connections. Server API keys are
 * CLI last-resort only and are never a hosted success state. The local
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

export const MISSING_ENV_MESSAGE =
  "Setup required — set ONSHAPE_OAUTH_CLIENT_ID and ONSHAPE_OAUTH_CLIENT_SECRET as deployment environment variables (Vercel → Project → Settings → Environment Variables), then redeploy. The callback URL to register on the Onshape OAuth application is shown on CAD Connections. Server API keys are CLI last-resort only and do not connect hosted CAD.";

export const MISSING_SESSION_MESSAGE =
  "Setup required — connect Onshape OAuth in CAD Connections (/cad/connections) before hosted CAD can edit a Part Studio.";

export const OAUTH_READY_MESSAGE =
  "Onshape OAuth client is configured. Users can connect in CAD Connections. Hosted calls spend the annual API allowance.";

export const CONNECTED_MESSAGE = "Onshape is connected for this team member.";

export function ready(
  reason: Exclude<OnshapeHostedReason, "missing_env" | "missing_session">,
  message: string,
): OnshapeHostedSetup {
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

export function blocked(
  reason: "missing_env" | "missing_session",
  message: string,
  connectCtaEnabled: boolean,
): OnshapeHostedSetup {
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

/**
 * "jane@team.org" out of the `onshape:jane@team.org` stored in
 * cad_connections.external_account_ref, so a card can say who it is connected as.
 *
 * Older rows stored `onshape:<vantage user uuid>`, which names nobody a student
 * recognises — those are reported as unlabelled rather than shown raw.
 */
export function onshapeAccountLabel(ref: string | null | undefined): string | null {
  if (!ref) return null;
  const value = (ref.startsWith("onshape:") ? ref.slice("onshape:".length) : ref).trim();
  if (!value) return null;
  const looksLikeUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
  return looksLikeUuid ? null : value;
}

export function withLocalPlaywrightHint(message: string): string {
  const trimmed = message.trim();
  if (!trimmed) return ONSHAPE_LOCAL_PLAYWRIGHT_HINT;
  if (/vantage-cad login|Playwright/i.test(trimmed)) return trimmed;
  return `${trimmed} ${ONSHAPE_LOCAL_PLAYWRIGHT_HINT}`;
}
