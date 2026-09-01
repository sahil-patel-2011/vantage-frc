/**
 * Honest hosted-Onshape setup copy for CAD Connections / Setup.
 *
 * Hosted ready = Onshape OAuth tokens in cad_connections. Server API keys
 * are CLI last-resort only and are never a hosted success state. The local
 * Playwright path (`vantage-cad login`) stays available either way. Nothing
 * here invents documents, STL/STEP/GLTF exports, or live geometry.
 *
 * Both CAD client components render this copy, so this module must import nothing
 * server-side. The env/session-dependent status lives in `onshape-setup-status.ts`.
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
