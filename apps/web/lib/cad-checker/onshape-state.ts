/**
 * Where a person stands with Onshape part checks, from the real configuration:
 *
 *  - "off": the deployment has no Onshape OAuth client (readHostedOnshapeEnvFlags), so nobody
 *    can connect. Said up front, with no Connect button that would lead nowhere.
 *  - "connect": Onshape is on, this person has no live connection — one Connect Onshape action.
 *  - "connected": they can use the checks that read Onshape (Learn CAD grader, guided tracks).
 *  - "unknown": the status couldn't be read (signed out, no team, network) — said honestly.
 */

export type OnshapeCheckState = "off" | "connect" | "connected" | "unknown";

export type OnshapeStatusPayload = {
  configured?: unknown;
  connections?: Array<{ status?: unknown }> | unknown;
};

export function onshapeCheckState(configured: boolean, status: OnshapeStatusPayload | null): OnshapeCheckState {
  if (!configured) return "off";
  if (!status) return "unknown";
  // The live answer wins: a deployment can lose its client between page load and this read.
  if (status.configured === false) return "off";
  const connections = Array.isArray(status.connections) ? status.connections : [];
  return connections.some((c) => (c as { status?: unknown } | null)?.status === "connected") ? "connected" : "connect";
}

export const ONSHAPE_OFF_COPY =
  "Onshape isn't switched on for Vantage yet. An owner can turn it on in Settings → Connectors; until then use the DXF check or ask a lead to sign off.";
