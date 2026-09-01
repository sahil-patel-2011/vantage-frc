import { isOnshapeOAuthConfigured, readOnshapeApiKeys } from "@vantage/cad";
import { hostedOnshapeAgentAuth, hostedOnshapeEnvAuth } from "./hosted-auth";
import {
  ONSHAPE_HOSTED_UNCONFIGURED_TITLE,
  ONSHAPE_LOCAL_PLAYWRIGHT_HINT,
  type HostedOnshapeFlags,
  type OnshapeHostedReason,
  type OnshapeHostedSetup,
} from "./onshape-setup-copy";

/**
 * Env- and session-dependent hosted-Onshape status.
 *
 * Kept apart from `onshape-setup-copy.ts` because `@vantage/cad` re-exports `@vantage/agent`,
 * which reaches `pg`. The CAD Setup and Connections client components render the copy, so the
 * copy module has to stay free of server imports or the browser bundle pulls the Postgres
 * driver and the production build fails to resolve `net`/`tls`/`dns`.
 */

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
