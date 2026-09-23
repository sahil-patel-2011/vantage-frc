import type { ConnectorStatus } from "./catalog";

/**
 * What a team sees on Connectors. Teams use the hosted app; they never run it. So they see
 * only the links they can actually make, and never the deployment's plumbing — no
 * environment-variable names, callback URLs to register, or provider-console steps, and
 * nothing that is deployment-wide (email, billing, TBA). The platform admin who runs the
 * deployment sees everything, in full, to set it up.
 */

export function connectorsForViewer(connectors: ConnectorStatus[], viewer: { platformAdmin: boolean }): ConnectorStatus[] {
  if (viewer.platformAdmin) return connectors;
  return connectors
    .filter((connector) => connector.scope !== "platform" && connector.state !== "not_configured")
    .map((connector) => ({ ...connector, missingEnv: [], callbackUrl: null, callbackLabel: "", providerConsole: "" }));
}
