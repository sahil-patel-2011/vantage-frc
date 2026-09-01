import { isOnshapeOAuthConfigured, readOnshapeApiKeys } from "@vantage/cad";

/**
 * Hosted Vantage CAD Onshape auth.
 *
 * Production path: OAuth tokens stored on cad_connections.
 * Local Playwright (`vantage-cad login`) is a laptop path, out of hosted.
 * Server API keys (ONSHAPE_ACCESS_KEY) are CLI last-resort only — they never
 * make hosted CAD connected or ready. Never log secrets.
 */

export type HostedOnshapeAuthFlags = {
  oauthConfigured: boolean;
  sessionConnected?: boolean;
  /** Present for callers that still detect keys. Ignored for hosted readiness. */
  apiKeyConfigured?: boolean;
};

export type HostedOnshapeAuthReason =
  | "missing_oauth_env"
  | "missing_session"
  | "oauth_ready"
  | "oauth_connected";

export type HostedOnshapeAuth = {
  configured: boolean;
  connected: boolean;
  setupRequired: boolean;
  status: "setup_required" | "ready";
  reason: HostedOnshapeAuthReason;
  via: "oauth" | null;
};

export function readHostedOnshapeEnvFlags(env: NodeJS.ProcessEnv = process.env): HostedOnshapeAuthFlags {
  return {
    oauthConfigured: isOnshapeOAuthConfigured(env),
    apiKeyConfigured: Boolean(readOnshapeApiKeys(env)),
  };
}

/** Hosted CAD is connected only when OAuth tokens exist in cad_connections. */
export function isHostedOnshapeConnected(flags: HostedOnshapeAuthFlags): boolean {
  return Boolean(flags.oauthConfigured && flags.sessionConnected);
}

/**
 * Env-level: OAuth client present → users can connect (not setup_required).
 * Keys-only → setup_required. Keys never count as connected.
 */
export function hostedOnshapeEnvAuth(
  flags: Pick<HostedOnshapeAuthFlags, "oauthConfigured" | "apiKeyConfigured">,
): HostedOnshapeAuth {
  if (flags.oauthConfigured) {
    return {
      configured: true,
      connected: false,
      setupRequired: false,
      status: "ready",
      reason: "oauth_ready",
      via: "oauth",
    };
  }
  return {
    configured: false,
    connected: false,
    setupRequired: true,
    status: "setup_required",
    reason: "missing_oauth_env",
    via: null,
  };
}

/**
 * Agent / token-loader: hosted ready only when OAuth env + cad_connections session.
 * Keys-only is setup_required and not connected.
 */
export function hostedOnshapeAgentAuth(
  flags: HostedOnshapeAuthFlags & { sessionConnected: boolean },
): HostedOnshapeAuth {
  if (isHostedOnshapeConnected(flags)) {
    return {
      configured: true,
      connected: true,
      setupRequired: false,
      status: "ready",
      reason: "oauth_connected",
      via: "oauth",
    };
  }
  if (flags.oauthConfigured) {
    return {
      configured: true,
      connected: false,
      setupRequired: true,
      status: "setup_required",
      reason: "missing_session",
      via: null,
    };
  }
  return {
    configured: false,
    connected: false,
    setupRequired: true,
    status: "setup_required",
    reason: "missing_oauth_env",
    via: null,
  };
}

export function hostedOnshapeAuthFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  sessionConnected = false,
): HostedOnshapeAuth {
  return hostedOnshapeAgentAuth({
    ...readHostedOnshapeEnvFlags(env),
    sessionConnected,
  });
}
