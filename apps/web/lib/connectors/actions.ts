/**
 * Which endpoint the connectors page calls for Connect and Disconnect, and how
 * a state becomes a badge.
 *
 * The endpoints are each connector's own route, not a new aggregate one: there
 * must be exactly one implementation of revoking a credential. `/api/github`
 * and `/api/cad/onshape` both overwrite the encrypted envelope on disconnect
 * rather than only flipping a status column — a second copy of that here would
 * be a second chance to write the easy, wrong version that leaves a live
 * refresh token decryptable in a row the UI calls disconnected.
 *
 * A connector missing from a map has no button on the page. That is the honest
 * answer for the ones whose link is a paste-a-webhook form (Discord, Slack save
 * paths), a deployment variable (Stripe, Resend, Google), or a pairing code
 * typed on another machine (storage node, Fusion relay).
 */
import type { BadgeTone } from "../../components/ui/badge";
import type { ConnectorId, ConnectorState, ConnectorStatus } from "./catalog";

export type ConnectorStatusView = ConnectorStatus;

const CONNECT_ENDPOINTS: Partial<Record<ConnectorId, string>> = {
  github: "/api/github",
  onshape: "/api/cad/onshape",
};

const DISCONNECT_ENDPOINTS: Partial<Record<ConnectorId, string>> = {
  github: "/api/github",
  onshape: "/api/cad/onshape",
  discord: "/api/team/discord",
  slack: "/api/team/slack",
};

export function connectorConnectEndpoint(id: ConnectorId): string | null {
  return CONNECT_ENDPOINTS[id] ?? null;
}

export function connectorDisconnectEndpoint(id: ConnectorId): string | null {
  return DISCONNECT_ENDPOINTS[id] ?? null;
}

/**
 * Colour is never the only channel — every tone here ships a text label too,
 * and `token_expired` gets its own wording rather than being folded into
 * "Connected" (which is what made a dead credential look healthy).
 */
export function connectorBadge(state: ConnectorState): { tone: BadgeTone; label: string } {
  switch (state) {
    case "connected":
      return { tone: "good", label: "Connected" };
    case "token_expired":
      return { tone: "error", label: "Token expired" };
    case "not_configured":
      return { tone: "setup", label: "Not configured" };
    case "ready":
      return { tone: "info", label: "Ready to connect" };
    default:
      return { tone: "neutral", label: "Not connected" };
  }
}
