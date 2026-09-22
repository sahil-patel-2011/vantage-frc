import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createGitHubOAuthState } from "../github/oauth";
import { pkceChallenge } from "./graph";
import {
  OAuthStateError,
  createMicrosoftOAuthState,
  pkceVerifierForNonce,
  verifyMicrosoftOAuthState,
} from "./oauth-state";

const ENV = { BETTER_AUTH_SECRET: "test-secret-value", NODE_ENV: "test" } as unknown as NodeJS.ProcessEnv;
const ORG = "6925a000-0000-4000-8000-000000000001";
const USER = "6925a000-0000-4000-8000-000000000002";

function reason(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (error) {
    return error instanceof OAuthStateError ? error.reason : "other";
  }
}

describe("Microsoft OAuth state", () => {
  it("round-trips the user and team it was issued for", () => {
    const state = createMicrosoftOAuthState({ orgId: ORG, userId: USER }, ENV);
    const claims = verifyMicrosoftOAuthState(state, ENV);
    expect(claims.orgId).toBe(ORG);
    expect(claims.userId).toBe(USER);
    expect(claims.nonce.length).toBeGreaterThan(10);
  });

  it("rejects a tampered body (swapping in another team)", () => {
    const state = createMicrosoftOAuthState({ orgId: ORG, userId: USER }, ENV);
    const [body, sig] = state.split(".");
    const decoded = JSON.parse(Buffer.from(body!, "base64url").toString("utf8"));
    decoded.orgId = "6925a000-0000-4000-8000-00000000ffff";
    const forged = `${Buffer.from(JSON.stringify(decoded)).toString("base64url")}.${sig}`;
    expect(reason(() => verifyMicrosoftOAuthState(forged, ENV))).toBe("signature");
  });

  it("rejects a state signed with another secret", () => {
    const state = createMicrosoftOAuthState({ orgId: ORG, userId: USER }, { ...ENV, BETTER_AUTH_SECRET: "other" });
    expect(reason(() => verifyMicrosoftOAuthState(state, ENV))).toBe("signature");
  });

  it("expires after 15 minutes", () => {
    const issued = Date.parse("2026-09-22T12:00:00Z");
    const state = createMicrosoftOAuthState({ orgId: ORG, userId: USER }, ENV, issued);
    expect(reason(() => verifyMicrosoftOAuthState(state, ENV, issued + 14 * 60_000))).toBeNull();
    expect(reason(() => verifyMicrosoftOAuthState(state, ENV, issued + 16 * 60_000))).toBe("expired");
  });

  it("rejects garbage", () => {
    expect(reason(() => verifyMicrosoftOAuthState("", ENV))).toBe("malformed");
    expect(reason(() => verifyMicrosoftOAuthState("abc", ENV))).toBe("malformed");
    expect(reason(() => verifyMicrosoftOAuthState("a.b.c", ENV))).toBe("malformed");
  });

  it("cannot be satisfied by a GitHub connector state signed with the same secret", () => {
    const github = createGitHubOAuthState({ orgId: ORG, userId: USER }, ENV);
    expect(reason(() => verifyMicrosoftOAuthState(github, ENV))).toBe("signature");
  });

  it("rejects a correctly signed body with the wrong purpose", () => {
    const body = Buffer.from(
      JSON.stringify({ purpose: "github", orgId: ORG, userId: USER, nonce: "n", issuedAt: Date.now() }),
    ).toString("base64url");
    const sig = createHmac("sha256", "test-secret-value").update(`microsoft-oauth-state|${body}`).digest("base64url");
    expect(reason(() => verifyMicrosoftOAuthState(`${body}.${sig}`, ENV))).toBe("purpose");
  });

  it("refuses to sign in production without BETTER_AUTH_SECRET", () => {
    const prod = { NODE_ENV: "production" } as unknown as NodeJS.ProcessEnv;
    expect(reason(() => createMicrosoftOAuthState({ orgId: ORG, userId: USER }, prod))).toBe("secret_missing");
  });

  it("derives a valid, secret-bound PKCE verifier from the nonce", () => {
    const verifier = pkceVerifierForNonce("nonce-1", ENV);
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(pkceVerifierForNonce("nonce-1", ENV)).toBe(verifier);
    expect(pkceVerifierForNonce("nonce-2", ENV)).not.toBe(verifier);
    expect(pkceVerifierForNonce("nonce-1", { ...ENV, BETTER_AUTH_SECRET: "x" })).not.toBe(verifier);
    expect(pkceChallenge(verifier)).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});
