import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Signed OAuth `state` for Connect Google Sheets, bound to the user and team that started it.
 *
 * Same construction as the Microsoft connector (lib/microsoft/oauth-state.ts), with its own
 * domain separation so a state minted for one provider can never be replayed at the other.
 * The callback trusts this state, not a session cookie: Google may send the person back to
 * a different Vantage host than the one they started on (see GOOGLE_SHEETS_REDIRECT_ORIGIN),
 * where they have no cookie. The state is HMAC-signed, expires in 15 minutes, and its nonce
 * derives the PKCE verifier — so only the flow this server started can finish.
 */

const PURPOSE = "google-sheets-mirror";
const DEFAULT_MAX_AGE_MS = 15 * 60_000;

export type GoogleOAuthClaims = { orgId: string; userId: string; nonce: string };

export class GoogleOAuthStateError extends Error {
  constructor(readonly reason: "malformed" | "signature" | "expired" | "purpose" | "secret_missing") {
    super(`Invalid Google OAuth state (${reason})`);
    this.name = "GoogleOAuthStateError";
  }
}

function stateSecret(env: NodeJS.ProcessEnv): string {
  const secret = env.BETTER_AUTH_SECRET?.trim();
  if (secret) return secret;
  if (env.NODE_ENV === "production") throw new GoogleOAuthStateError("secret_missing");
  return "local-google-oauth-state";
}

function sign(body: string, env: NodeJS.ProcessEnv): string {
  return createHmac("sha256", stateSecret(env)).update(`google-oauth-state|${body}`).digest("base64url");
}

export function createGoogleOAuthState(
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

export function verifyGoogleOAuthState(
  state: string,
  env: NodeJS.ProcessEnv = process.env,
  now = Date.now(),
  maxAgeMs = DEFAULT_MAX_AGE_MS,
): GoogleOAuthClaims {
  const parts = state.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) throw new GoogleOAuthStateError("malformed");
  const [body, sig] = parts as [string, string];
  const expected = Buffer.from(sign(body, env));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    throw new GoogleOAuthStateError("signature");
  }
  let parsed: { purpose?: unknown; orgId?: unknown; userId?: unknown; nonce?: unknown; issuedAt?: unknown };
  try {
    parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    throw new GoogleOAuthStateError("malformed");
  }
  if (parsed.purpose !== PURPOSE) throw new GoogleOAuthStateError("purpose");
  if (typeof parsed.orgId !== "string" || typeof parsed.userId !== "string" || typeof parsed.nonce !== "string") {
    throw new GoogleOAuthStateError("malformed");
  }
  const issuedAt = Number(parsed.issuedAt);
  if (!Number.isFinite(issuedAt) || now - issuedAt > maxAgeMs || issuedAt - now > 60_000) {
    throw new GoogleOAuthStateError("expired");
  }
  return { orgId: parsed.orgId, userId: parsed.userId, nonce: parsed.nonce };
}

/** RFC 7636 code_verifier, derived from the nonce — never stored. */
export function googlePkceVerifier(nonce: string, env: NodeJS.ProcessEnv = process.env): string {
  return createHmac("sha256", stateSecret(env)).update(`google-pkce|${nonce}`).digest("base64url");
}

export function googlePkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}
