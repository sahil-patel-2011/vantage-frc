import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const GITHUB_OAUTH_AUTHORIZE = "https://github.com/login/oauth/authorize";
export const GITHUB_OAUTH_TOKEN = "https://github.com/login/oauth/access_token";
export const GITHUB_API_BASE = "https://api.github.com";

/** Read-oriented classic scopes. Never request `workflow`; app never pushes. */
export const GITHUB_DEFAULT_SCOPES = ["read:user", "repo"] as const;

export type GitHubOAuthConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes: string[];
};

export type GitHubTokenSet = {
  accessToken: string;
  tokenType?: string;
  scope?: string;
  /** PAT has no refresh; OAuth Apps also typically return no refresh_token. */
  refreshToken?: string;
  expiresAt?: number;
};

export function isGitHubOAuthConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.GITHUB_OAUTH_CLIENT_ID?.trim() && env.GITHUB_OAUTH_CLIENT_SECRET?.trim());
}

/**
 * The Authorization callback URL an admin pastes into the GitHub OAuth App.
 *
 * Computed from the deployment base URL alone, deliberately NOT gated on the
 * client credentials: the admin who has not created the OAuth App yet is the
 * only person who needs this string, and they cannot produce a client id
 * without first entering this URL on GitHub. `redirectUri` on the config keeps
 * its null-when-unconfigured semantics because the Connect button reads it as
 * "OAuth is usable". (Same split as `onshapeCallbackUrl`.)
 */
export function githubCallbackUrl(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env.GITHUB_OAUTH_REDIRECT_URI?.trim();
  if (explicit) return explicit;
  const base = (env.BETTER_AUTH_URL ?? env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3001").replace(/\/$/, "");
  return `${base}/api/github/oauth/callback`;
}

export function githubMissingEnv(env: NodeJS.ProcessEnv = process.env): string[] {
  const missing: string[] = [];
  if (!env.GITHUB_OAUTH_CLIENT_ID?.trim()) missing.push("GITHUB_OAUTH_CLIENT_ID");
  if (!env.GITHUB_OAUTH_CLIENT_SECRET?.trim()) missing.push("GITHUB_OAUTH_CLIENT_SECRET");
  return missing;
}

export function getGitHubOAuthConfig(env: NodeJS.ProcessEnv = process.env): GitHubOAuthConfig | null {
  if (!isGitHubOAuthConfigured(env)) return null;
  return {
    clientId: env.GITHUB_OAUTH_CLIENT_ID!.trim(),
    clientSecret: env.GITHUB_OAUTH_CLIENT_SECRET!.trim(),
    redirectUri: githubCallbackUrl(env),
    scopes: (env.GITHUB_OAUTH_SCOPES?.trim() || GITHUB_DEFAULT_SCOPES.join(" ")).split(/\s+/).filter(Boolean),
  };
}

export function githubSetupStatus(env: NodeJS.ProcessEnv = process.env) {
  const configured = isGitHubOAuthConfigured(env);
  const config = configured ? getGitHubOAuthConfig(env) : null;
  const callbackUrl = githubCallbackUrl(env);
  const missingEnv = githubMissingEnv(env);
  const scopes = config?.scopes ?? [...GITHUB_DEFAULT_SCOPES];
  // Feature is never blocked: PAT encrypt/save works without GITHUB_OAUTH_*.
  // Only the OAuth button needs server credentials.
  return {
    configured,
    /** True only when the OAuth App credentials are missing — PAT path still works. */
    oauthSetupRequired: !configured,
    /** Always false: org GitHub context is available via encrypted PAT without OAuth env. */
    setupRequired: false,
    redirectUri: config?.redirectUri ?? null,
    /** Always present — the URL to register even before the client exists. */
    callbackUrl,
    missingEnv,
    scopes,
    patAvailable: true,
    message: configured
      ? `GitHub OAuth is configured. Owners/admins can connect a robot-code repo in Team settings. Registered Authorization callback URL: ${callbackUrl}`
      : `Needs setup — set ${missingEnv.join(" and ")} in your deployment environment (Vercel → Project → Settings → Environment Variables), then redeploy. Create the app at github.com → Settings → Developer settings → OAuth Apps and register this exact Authorization callback URL: ${callbackUrl} (scopes: ${scopes.join(", ")}). Until then, owners/admins can still encrypt and save a fine-grained or classic PAT in Team settings — that path needs no OAuth App.`,
  };
}

function stateSecret(env: NodeJS.ProcessEnv = process.env) {
  return env.BETTER_AUTH_SECRET ?? env.GITHUB_OAUTH_STATE_SECRET ?? "local-github-oauth-state";
}

export function createGitHubOAuthState(
  input: { orgId: string; userId: string },
  env: NodeJS.ProcessEnv = process.env,
) {
  const nonce = randomBytes(16).toString("base64url");
  const issuedAt = Date.now();
  const body = Buffer.from(JSON.stringify({ ...input, nonce, issuedAt }), "utf8").toString("base64url");
  const sig = createHmac("sha256", stateSecret(env)).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyGitHubOAuthState(
  state: string,
  env: NodeJS.ProcessEnv = process.env,
  maxAgeMs = 15 * 60_000,
): { orgId: string; userId: string; nonce: string } {
  const [body, sig] = state.split(".");
  if (!body || !sig) throw new Error("Invalid OAuth state");
  const expected = createHmac("sha256", stateSecret(env)).update(body).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error("Invalid OAuth state signature");
  const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as {
    orgId: string;
    userId: string;
    nonce: string;
    issuedAt: number;
  };
  if (!parsed.orgId || !parsed.userId || !parsed.nonce) throw new Error("OAuth state missing fields");
  if (Date.now() - parsed.issuedAt > maxAgeMs) throw new Error("OAuth state expired");
  return { orgId: parsed.orgId, userId: parsed.userId, nonce: parsed.nonce };
}

export function buildGitHubAuthorizeUrl(config: GitHubOAuthConfig, state: string) {
  const url = new URL(GITHUB_OAUTH_AUTHORIZE);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("scope", config.scopes.join(" "));
  url.searchParams.set("state", state);
  return url.toString();
}

export async function exchangeGitHubCode(config: GitHubOAuthConfig, code: string): Promise<GitHubTokenSet> {
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code,
    redirect_uri: config.redirectUri,
  });
  const response = await fetch(GITHUB_OAUTH_TOKEN, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = (await response.json()) as Record<string, unknown>;
  if (!response.ok || data.error) {
    throw new Error(String(data.error_description ?? data.error ?? "GitHub token exchange failed"));
  }
  return {
    accessToken: String(data.access_token),
    tokenType: data.token_type ? String(data.token_type) : "bearer",
    scope: data.scope ? String(data.scope) : undefined,
  };
}
