/**
 * Server-only Fusion relay readiness. Client Components must not import this
 * file — it reads process.env. Student copy lives in fusion-setup-strings.ts.
 */

import {
  fusionHostedBlocked,
  fusionHostedReady,
  type FusionHostedSetup,
} from "./fusion-setup-strings";

/** True when this deployment can sign Fusion relay jobs. Never log the value. */
export function isFusionRelaySigningConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.FUSION_RELAY_SIGNING_SECRET?.trim());
}

/** Env-level Fusion status. Missing config is setup_required, never a crash. */
export function hostedFusionSetup(env: NodeJS.ProcessEnv = process.env): FusionHostedSetup {
  if (isFusionRelaySigningConfigured(env)) return fusionHostedReady();
  return fusionHostedBlocked();
}
