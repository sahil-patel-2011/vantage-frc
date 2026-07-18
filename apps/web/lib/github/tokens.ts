import type { PoolClient } from "@neondatabase/serverless";
import { createKms, decryptSecret, encryptSecret, type EncryptedSecret } from "@vantage/billing";
import { createGitHubHttp, fetchGitHubUser } from "./api";
import type { GitHubTokenSet } from "./oauth";

export type GitHubConnectionRow = {
  id: string;
  orgId: string;
  authMethod: "oauth" | "pat";
  label: string;
  status: string;
  githubLogin: string | null;
  githubUserId: string | null;
  defaultRepoFullName: string | null;
  defaultRepoDefaultBranch: string | null;
  scopes: string[];
  lastTestedAt: string | null;
  disabledAt: string | null;
  encryptedCredentials: string;
};

export async function loadGitHubConnection(
  client: PoolClient,
  orgId: string,
): Promise<GitHubConnectionRow | null> {
  const result = await client.query<{
    id: string;
    org_id: string;
    auth_method: "oauth" | "pat";
    label: string;
    status: string;
    github_login: string | null;
    github_user_id: string | null;
    default_repo_full_name: string | null;
    default_repo_default_branch: string | null;
    scopes: string[];
    last_tested_at: string | null;
    disabled_at: string | null;
    encrypted_credentials: string;
  }>(
    `SELECT id, org_id, auth_method, label, status, github_login, github_user_id,
            default_repo_full_name, default_repo_default_branch, scopes,
            last_tested_at, disabled_at, encrypted_credentials
     FROM github_connections
     WHERE org_id=$1::uuid AND disabled_at IS NULL AND status='connected'
     LIMIT 1`,
    [orgId],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    orgId: row.org_id,
    authMethod: row.auth_method,
    label: row.label,
    status: row.status,
    githubLogin: row.github_login,
    githubUserId: row.github_user_id,
    defaultRepoFullName: row.default_repo_full_name,
    defaultRepoDefaultBranch: row.default_repo_default_branch,
    scopes: row.scopes ?? [],
    lastTestedAt: row.last_tested_at,
    disabledAt: row.disabled_at,
    encryptedCredentials: row.encrypted_credentials,
  };
}

export async function decryptGitHubTokens(encryptedCredentials: string): Promise<GitHubTokenSet> {
  const parsed = JSON.parse(encryptedCredentials) as EncryptedSecret;
  const plaintext = await decryptSecret(parsed, createKms());
  return JSON.parse(plaintext) as GitHubTokenSet;
}

export async function encryptGitHubTokens(tokens: GitHubTokenSet): Promise<string> {
  const encrypted = await encryptSecret(JSON.stringify(tokens), createKms());
  return JSON.stringify(encrypted);
}

export async function getGitHubAccessToken(client: PoolClient, orgId: string): Promise<{
  connection: GitHubConnectionRow;
  accessToken: string;
} | null> {
  const connection = await loadGitHubConnection(client, orgId);
  if (!connection) return null;
  const tokens = await decryptGitHubTokens(connection.encryptedCredentials);
  if (!tokens.accessToken?.trim()) return null;
  return { connection, accessToken: tokens.accessToken };
}

export async function upsertGitHubConnection(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    authMethod: "oauth" | "pat";
    tokens: GitHubTokenSet;
    scopes: string[];
    label?: string;
  },
) {
  const http = createGitHubHttp(input.tokens.accessToken);
  const user = await fetchGitHubUser(http);
  if (!user.login) throw new Error("GitHub token did not return a user login");
  const payload = await encryptGitHubTokens(input.tokens);
  const existing = await client.query<{ id: string }>(
    `SELECT id FROM github_connections WHERE org_id=$1::uuid LIMIT 1`,
    [input.orgId],
  );
  if (existing.rows[0]) {
    await client.query(
      `UPDATE github_connections
       SET connected_by=$2::uuid, auth_method=$3, label=$4, encrypted_credentials=$5,
           scopes=$6::text[], status='connected', github_login=$7, github_user_id=$8,
           disabled_at=NULL, last_tested_at=now(), updated_at=now()
       WHERE org_id=$1::uuid`,
      [
        input.orgId,
        input.userId,
        input.authMethod,
        input.label ?? "GitHub",
        payload,
        input.scopes,
        user.login,
        user.id || null,
      ],
    );
    return existing.rows[0].id;
  }
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO github_connections(
       org_id, connected_by, auth_method, label, encrypted_credentials, scopes,
       status, github_login, github_user_id, last_tested_at
     ) VALUES ($1::uuid,$2::uuid,$3,$4,$5,$6::text[],'connected',$7,$8,now())
     RETURNING id`,
    [
      input.orgId,
      input.userId,
      input.authMethod,
      input.label ?? "GitHub",
      payload,
      input.scopes,
      user.login,
      user.id || null,
    ],
  );
  return inserted.rows[0]!.id;
}

export async function requireOrgAdmin(client: PoolClient, orgId: string, userId: string) {
  const member = await client.query(
    `SELECT role FROM memberships WHERE org_id=$1::uuid AND user_id=$2::uuid`,
    [orgId, userId],
  );
  if (!member.rowCount) throw new Error("Organization access denied");
  const role = String(member.rows[0]?.role ?? "");
  if (!["owner", "admin"].includes(role)) {
    throw new Error("Only organization owners and admins can manage the GitHub connection");
  }
}

export async function requireOrgMember(client: PoolClient, orgId: string, userId: string) {
  const member = await client.query(
    `SELECT 1 FROM memberships WHERE org_id=$1::uuid AND user_id=$2::uuid`,
    [orgId, userId],
  );
  if (!member.rowCount) throw new Error("Organization access denied");
}
