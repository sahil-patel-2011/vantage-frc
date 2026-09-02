import type { PoolClient } from "@neondatabase/serverless";
import { createKms, decryptSecret, encryptSecret, type EncryptedSecret } from "@vantage/billing";
import {
  createOnshapeApiKeyHttp,
  createOnshapeHttp,
  getOnshapeOAuthConfig,
  readOnshapeApiKeys,
  refreshOnshapeToken,
  type OnshapeHttp,
  type OnshapeTokenSet,
} from "@vantage/cad";

/** How the Onshape client was obtained, in resolution order. */
export type OnshapeConnectionVia = "oauth" | "team_oauth" | "api_key";

export type CadAgentOnshapeClient = {
  http: OnshapeHttp;
  connectionId: string | null;
  via: OnshapeConnectionVia;
};

export type OnshapeConnectionRow = {
  id: string;
  encrypted_credentials: string | null;
  /** null = the org's shared team connection (0493_cad_team_connections.sql). */
  user_id: string | null;
  label: string;
};

/**
 * The connection this user may drive Onshape with: their own row first, then
 * the org's team row (user_id IS NULL, readable by every member under RLS).
 * Only connected, non-disabled rows count.
 */
export async function findOnshapeConnection(
  client: PoolClient,
  orgId: string,
  userId: string,
): Promise<OnshapeConnectionRow | null> {
  const result = await client.query<OnshapeConnectionRow>(
    `SELECT id, encrypted_credentials, user_id, label FROM cad_connections
     WHERE org_id=$1::uuid AND platform='onshape' AND status='connected' AND disabled_at IS NULL
       AND (user_id=$2::uuid OR user_id IS NULL)
     ORDER BY (user_id IS NULL) ASC, updated_at DESC
     LIMIT 1`,
    [orgId, userId],
  );
  return result.rows[0] ?? null;
}

export type OnshapeAvailability = {
  /** OAuth env is set, or server API keys exist — the feature can work on this deployment. */
  configured: boolean;
  /** Something this user can actually call Onshape with right now. */
  connected: boolean;
  via: OnshapeConnectionVia | null;
  /** True when the usable connection is the shared team row rather than the caller's own. */
  team: boolean;
};

/**
 * Mirrors what loadCadAgentOnshape() will accept, so routes can answer
 * setup_required instead of burning a metered AI call on a dead tool layer.
 */
export async function onshapeAvailability(client: PoolClient, orgId: string, userId: string): Promise<OnshapeAvailability> {
  const config = getOnshapeOAuthConfig();
  const apiKeys = Boolean(readOnshapeApiKeys());
  const row = await findOnshapeConnection(client, orgId, userId);
  const oauthReady = Boolean(row?.encrypted_credentials) && Boolean(config);
  const via: OnshapeConnectionVia | null = oauthReady ? (row!.user_id ? "oauth" : "team_oauth") : apiKeys ? "api_key" : null;
  return {
    configured: Boolean(config) || apiKeys,
    connected: via !== null,
    via,
    team: via === "team_oauth",
  };
}

/**
 * Store a refreshed token set on the connection that produced it. Goes through
 * rotate_cad_connection_credentials() (0493) rather than a plain UPDATE: a
 * member using the team row could never persist the rotation under RLS, and
 * Onshape issues a new refresh token on every refresh, so every copy of the
 * same OAuth grant (the sharer's own row and the team row) must receive it
 * together or one copy is stranded. Returns the number of rows updated.
 */
export async function persistRotatedOnshapeTokens(
  client: PoolClient,
  connectionId: string,
  tokens: OnshapeTokenSet,
): Promise<number> {
  const encrypted = await encryptSecret(JSON.stringify(tokens), createKms());
  const result = await client.query<{ touched: number }>(
    `SELECT rotate_cad_connection_credentials($1::uuid, $2) AS touched`,
    [connectionId, JSON.stringify(encrypted)],
  );
  return Number(result.rows[0]?.touched ?? 0);
}

export async function loadCadAgentOnshape(
  client: PoolClient,
  orgId: string,
  userId: string,
): Promise<CadAgentOnshapeClient> {
  const config = getOnshapeOAuthConfig();
  const row = await findOnshapeConnection(client, orgId, userId);

  if (row?.encrypted_credentials && config) {
    let tokens = JSON.parse(
      await decryptSecret(JSON.parse(row.encrypted_credentials) as EncryptedSecret, createKms()),
    ) as OnshapeTokenSet;
    if (tokens.expiresAt < Date.now() + 60_000) {
      tokens = await refreshOnshapeToken(config, tokens.refreshToken);
      await persistRotatedOnshapeTokens(client, row.id, tokens);
    }
    return {
      http: createOnshapeHttp(tokens.accessToken),
      connectionId: row.id,
      via: row.user_id ? "oauth" : "team_oauth",
    };
  }

  const keys = readOnshapeApiKeys();
  if (keys) {
    return { http: createOnshapeApiKeyHttp(keys), connectionId: row?.id ?? null, via: "api_key" };
  }

  if (!config) {
    throw new Error(
      "Setup required — connect Onshape in CAD Connections, or set ONSHAPE_ACCESS_KEY and ONSHAPE_SECRET_KEY on this server.",
    );
  }
  throw new Error("Connect Onshape in CAD Connections (or ask an owner/admin to share a team connection) before the CAD agent can edit a Part Studio.");
}
