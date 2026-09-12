import { isOnshapeOAuthConfigured, readOnshapeApiKeys } from "@vantage/cad";
import { hostedOnshapeAgentAuth, hostedOnshapeEnvAuth } from "./hosted-auth";
import {
  blocked,
  CONNECTED_MESSAGE,
  MISSING_ENV_MESSAGE,
  MISSING_SESSION_MESSAGE,
  OAUTH_READY_MESSAGE,
  ready,
  type HostedOnshapeFlags,
  type OnshapeHostedSetup,
} from "./onshape-setup-strings";

/**
 * Hosted-Onshape status that reads env and auth. Server-only.
 *
 * `@vantage/cad` and `./hosted-auth` reach `@vantage/agent`, whose web tools
 * need `dns`, `net`, `tls` and `fs`. A Client Component that imports this file
 * drags those into the browser bundle and the build fails with
 * "Module not found: Can't resolve 'dns'" — which is what took production down.
 * Client code imports `./onshape-setup-strings` instead.
 *
 * The pure copy is re-exported below so existing server callers keep one import.
 */
export * from "./onshape-setup-strings";

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

/**
 * Student CAD APIs must not leak operator setup: env-var names, callback URLs,
 * or "Setup required —". Connectors catalog stays the operator surface.
 */
export function studentOnshapeApiSetup(env: NodeJS.ProcessEnv = process.env) {
  const hosted = hostedOnshapeEnvStatus(env);
  return {
    configured: hosted.configured,
    setupRequired: hosted.setupRequired,
    message: hosted.message,
    connectCtaEnabled: hosted.connectCtaEnabled,
  };
}
