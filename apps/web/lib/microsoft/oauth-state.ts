import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Signed OAuth `state` for Connect Microsoft, bound to the user and team that started it.
 *
 * Same shape as the GitHub connector's state (lib/github/oauth.ts): base64url JSON body +
 * HMAC-SHA256 over it with BETTER_AUTH_SECRET. Two differences, both on purpose:
 *
 *  - The HMAC is domain-separated ("microsoft-oauth-state|") and the body carries a
 *    `purpose`, so a GitHub state signed with the same secret can never be replayed here.
 *  - In production a missing BETTER_AUTH_SECRET is an error, not a fallback string.
 *
 * The PKCE code_verifier is derived from the state's nonce with the same secret, so the
 * flow needs no server-side storage and no cookie: only this server can compute the
 * verifier, and it is only valid for the one authorize request that carried that nonce.
 */

const PURPOSE = "microsoft-workbook";
const DEFAULT_MAX_AGE_MS = 15 * 60_000;

export type MicrosoftOAuthClaims = { orgId: string; userId: string; nonce: string };

export class OAuthStateError extends Error {
  constructor(readonly reason: "malformed" | "signature" | "expired" | "purpose" | "secret_missing") {
    super(`Invalid Microsoft OAuth state (${reason})`);
    this.name = "OAuthStateError";
  }
}

function stateSecret(env: NodeJS.ProcessEnv): string {
  const secret = env.BETTER_AUTH_SECRET?.trim();
  if (secret) return secret;
  if (env.NODE_ENV === "production") throw new OAuthStateError("secret_missing");
  return "local-microsoft-oauth-state";
}

function sign(body: string, env: NodeJS.ProcessEnv): string {
  return createHmac("sha256", stateSecret(env)).update(`microsoft-oauth-state|${body}`).digest("base64url");
}

export function createMicrosoftOAuthState(
  input: { orgId: string; userId: string },
  env: NodeJS.ProcessEnv = process.env,
  now = Date.now(),
): string {
  const nonce = randomBytes(16).toString("base64url");
  const body = Buffer.from(
    JSON.stringify({ purpose: PURPOSE, orgId: input.orgId, userId: input.userId, nonce, issuedAt: now }),
    "utf8",
  ).toString("base64url");
  return `${body}.${sign(body, env)}`;
}

export function verifyMicrosoftOAuthState(
  state: string,
  env: NodeJS.ProcessEnv = process.env,
  now = Date.now(),
  maxAgeMs = DEFAULT_MAX_AGE_MS,
): MicrosoftOAuthClaims {
  const parts = state.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) throw new OAuthStateError("malformed");
  const [body, sig] = parts as [string, string];
  const expected = Buffer.from(sign(body, env));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    throw new OAuthStateError("signature");
  }
  let parsed: { purpose?: unknown; orgId?: unknown; userId?: unknown; nonce?: unknown; issuedAt?: unknown };
  try {
    parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    throw new OAuthStateError("malformed");
  }
  if (parsed.purpose !== PURPOSE) throw new OAuthStateError("purpose");
  if (typeof parsed.orgId !== "string" || typeof parsed.userId !== "string" || typeof parsed.nonce !== "string") {
    throw new OAuthStateError("malformed");
  }
  const issuedAt = Number(parsed.issuedAt);
  if (!Number.isFinite(issuedAt) || now - issuedAt > maxAgeMs || issuedAt - now > 60_000) {
    throw new OAuthStateError("expired");
  }
  return { orgId: parsed.orgId, userId: parsed.userId, nonce: parsed.nonce };
}

/** RFC 7636 code_verifier: 43 base64url characters, derived — never stored. */
export function pkceVerifierForNonce(nonce: string, env: NodeJS.ProcessEnv = process.env): string {
  return createHmac("sha256", stateSecret(env)).update(`microsoft-pkce|${nonce}`).digest("base64url");
}
