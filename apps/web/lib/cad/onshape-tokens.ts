import type { PoolClient } from "@neondatabase/serverless";
import { createKms, decryptSecret, encryptSecret, type EncryptedSecret } from "@vantage/billing";
import {
  createOnshapeHttp,
  getOnshapeOAuthConfig,
  refreshOnshapeToken,
  type OnshapeHttp,
  type OnshapeTokenSet,
} from "@vantage/cad";
import { hostedOnshapeAgentAuth } from "./hosted-auth";
import { hostedOnshapeAgentStatus } from "./onshape-setup-copy";

export type CadAgentOnshapeClient = {
  http: OnshapeHttp;
  connectionId: string | null;
  via: "oauth";
};

export async function loadCadAgentOnshape(
  client: PoolClient,
  orgId: string,
  userId: string,
): Promise<CadAgentOnshapeClient> {
  const config = getOnshapeOAuthConfig();
  const row = (
    await client.query<{ id: string; encrypted_credentials: string }>(
      `SELECT id, encrypted_credentials FROM cad_connections
       WHERE org_id=$1::uuid AND user_id=$2::uuid AND platform='onshape' AND status='connected' AND disabled_at IS NULL
       ORDER BY updated_at DESC LIMIT 1`,
      [orgId, userId],
    )
  ).rows[0];

  const auth = hostedOnshapeAgentAuth({
    oauthConfigured: Boolean(config),
    apiKeyConfigured: false,
    sessionConnected: Boolean(row?.encrypted_credentials),
  });

  if (row?.encrypted_credentials && config && !auth.setupRequired) {
    let tokens = JSON.parse(
      await decryptSecret(JSON.parse(row.encrypted_credentials) as EncryptedSecret, createKms()),
    ) as OnshapeTokenSet;
    if (tokens.expiresAt < Date.now() + 60_000) {
      tokens = await refreshOnshapeToken(config, tokens.refreshToken);
      const encrypted = await encryptSecret(JSON.stringify(tokens), createKms());
      await client.query(
        `UPDATE cad_connections SET encrypted_credentials=$2, last_tested_at=now(), updated_at=now() WHERE id=$1::uuid`,
        [row.id, JSON.stringify(encrypted)],
      );
    }
    return { http: createOnshapeHttp(tokens.accessToken), connectionId: row.id, via: "oauth" };
  }

  const setup = hostedOnshapeAgentStatus({
    oauthConfigured: Boolean(config),
    apiKeyConfigured: false,
    sessionConnected: Boolean(row),
  });
  throw new Error(setup.message);
}
