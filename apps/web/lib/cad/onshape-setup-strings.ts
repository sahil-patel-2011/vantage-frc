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

export const ONSHAPE_HOSTED_UNCONFIGURED_TITLE = "Onshape isn't ready yet";

export const ONSHAPE_LOCAL_PLAYWRIGHT_HINT =
  "On a laptop, the desktop CAD app can still sign in to Onshape in a browser window without API keys.";

export const ONSHAPE_NO_INVENTED_EXPORTS =
  "Onshape documents and STL, STEP, or GLTF exports appear only after a real connected run. Empty CAD stays empty until then.";

export const ONSHAPE_PLATFORM_HINT_UNCONFIGURED =
  "Ask a mentor to finish Onshape setup for this team, then connect in CAD Connections.";

export const ONSHAPE_PLATFORM_HINT_CONFIGURED =
  "Connect Onshape in CAD Connections. Hosted jobs run after you authorize in the browser.";

export const ONSHAPE_HOSTED_BADGE = {
  connected: "Connected",
  oauthReady: "Ready to connect",
  adminSetup: "Ask a mentor",
} as const;

export const ONSHAPE_OAUTH_CTA = {
  connect: "Connect Onshape",
  reconnect: "Reconnect Onshape",
  disabledTitle: "Onshape isn't ready yet",
  disabledDetail:
    "Ask a mentor to finish Onshape setup for this team, then come back to connect.",
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
  "Onshape isn't ready for this team yet. Ask a mentor to finish CAD setup, then connect in CAD Connections.";

export const MISSING_SESSION_MESSAGE =
  "Connect Onshape in CAD Connections before hosted CAD jobs can run.";

export const OAUTH_READY_MESSAGE =
  "Onshape is ready to connect in CAD Connections.";

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
    message,
    bannerTitle: reason === "missing_env" ? ONSHAPE_HOSTED_UNCONFIGURED_TITLE : "Connect Onshape",
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
  if (/vantage-cad login|Playwright|desktop CAD app/i.test(trimmed)) return trimmed;
  return `${trimmed} ${ONSHAPE_LOCAL_PLAYWRIGHT_HINT}`;
}
