/**
 * Upload/download grants for direct browser-to-node transfers.
 *
 * The cloud mints a short-lived, single-use, HMAC-signed token scoped to one
 * org + one sha256 + a byte ceiling. The node verifies it OFFLINE — no cloud
 * round trip — because the signing key is the node's access-key hash, which
 * the node has kept in its config since pairing (0484: the node stores only
 * sha256(accessKey); the cloud stores the KMS-encrypted accessKey and can
 * recompute the same hash). The browser sees only the signed grant, never the
 * node's master access key, so a leaked grant authorizes exactly one file for
 * a few minutes instead of everything forever.
 *
 * Security honesty: anyone holding the master access key could forge grants
 * (they can also just call the node directly with it), so grants are strictly
 * no weaker than the pre-existing access-key auth — they exist to let the
 * upload path STOP handing that master key to browsers.
 *
 * The exact token format is mirrored in packages/storage-node/server.mjs
 * (stdlib-only). Both sides pin shared test vectors — see grants.test.ts and
 * packages/storage-node/server.test.ts — so the implementations cannot drift.
 *
 * Server-only module (node:crypto): imported by API routes, never by client
 * components.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

export const GRANT_TOKEN_PREFIX = "sg1";

/** Default upload-grant lifetime. Short on purpose; resuming mints a new one. */
export const UPLOAD_GRANT_TTL_SECONDS = 15 * 60;

/** Download grants live longer so video seeking keeps working mid-playback. */
export const DOWNLOAD_GRANT_TTL_SECONDS = 60 * 60;

/** One-shot PUT above this size switches to the chunked/resumable protocol. */
export const CHUNKED_UPLOAD_THRESHOLD_BYTES = 64 * 1024 * 1024;

/** Chunk size for the resumable protocol (small enough to retry cheaply). */
export const UPLOAD_CHUNK_BYTES = 8 * 1024 * 1024;

export type GrantOp = "upload" | "get";

export type GrantPayload = {
  v: 1;
  op: GrantOp;
  org: string;
  sha256: string;
  maxBytes: number;
  nonce: string;
  exp: number; // epoch seconds
};

function base64UrlEncode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

/** Deterministic serialization: fixed key order, no whitespace. */
export function canonicalGrantPayload(payload: GrantPayload): string {
  return JSON.stringify({
    v: payload.v,
    op: payload.op,
    org: payload.org,
    sha256: payload.sha256,
    maxBytes: payload.maxBytes,
    nonce: payload.nonce,
    exp: payload.exp,
  });
}

function signGrant(body: string, keyHex: string): string {
  return createHmac("sha256", Buffer.from(keyHex, "utf8")).update(body, "utf8").digest("hex");
}

/**
 * Mint a signed grant token. `signingKey` is the node's access-key hash
 * (64 lowercase hex chars) — sha256(accessKey), the value the node has kept
 * since pairing.
 */
export function mintGrantToken(payload: GrantPayload, signingKey: string): string {
  const body = `${GRANT_TOKEN_PREFIX}.${base64UrlEncode(canonicalGrantPayload(payload))}`;
  return `${body}.${signGrant(body, signingKey)}`;
}

export type GrantVerification =
  | { ok: true; payload: GrantPayload }
  | { ok: false; reason: string };

/**
 * Verify a grant token (the same checks the node performs). Exported here for
 * tests and for any future cloud-side re-validation.
 */
export function verifyGrantToken(
  token: string,
  expectations: { signingKey: string; org: string; sha256: string; op: GrantOp; nowMs: number },
): GrantVerification {
  if (typeof token !== "string") return { ok: false, reason: "missing token" };
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== GRANT_TOKEN_PREFIX) {
    return { ok: false, reason: "malformed token" };
  }
  const body = `${parts[0]}.${parts[1]}`;
  const expected = signGrant(body, expectations.signingKey);
  const given = parts[2]!;
  if (given.length !== expected.length) return { ok: false, reason: "bad signature" };
  try {
    if (!timingSafeEqual(Buffer.from(given, "hex"), Buffer.from(expected, "hex"))) {
      return { ok: false, reason: "bad signature" };
    }
  } catch {
    return { ok: false, reason: "bad signature" };
  }

  let payload: GrantPayload;
  try {
    payload = JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8")) as GrantPayload;
  } catch {
    return { ok: false, reason: "malformed payload" };
  }
  if (payload.v !== 1) return { ok: false, reason: "unsupported grant version" };
  if (payload.op !== expectations.op) return { ok: false, reason: `grant does not authorize ${expectations.op}` };
  if (payload.org !== expectations.org) return { ok: false, reason: "grant is for a different organization" };
  if (payload.sha256 !== expectations.sha256) return { ok: false, reason: "grant is for a different item" };
  if (!Number.isFinite(payload.exp) || payload.exp * 1000 <= expectations.nowMs) {
    return { ok: false, reason: "grant expired" };
  }
  if (!Number.isFinite(payload.maxBytes) || payload.maxBytes < 1) {
    return { ok: false, reason: "grant has no byte budget" };
  }
  return { ok: true, payload };
}
