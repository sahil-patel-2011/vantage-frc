/**
 * Drive share tokens.
 *
 * The token in a /s/<token> URL is the entire authorization — the recipient
 * has no account and never will, which is the whole point of a share link. So
 * it is 16 bytes of CSPRNG randomness (128 bits, not guessable), only its
 * sha256 is stored, and the plaintext is returned exactly once at creation. A
 * database dump does not hand anyone a working link, and "resend the link"
 * means "make a new share", not "look up the old token".
 *
 * Server-only (node:crypto). The format check lives in validation.ts so the
 * client and proxy.ts can share it.
 */

import { randomBytes, createHash } from "node:crypto";

export { DRIVE_SHARE_TOKEN_PATTERN, isDriveShareToken } from "./validation";

/** 32 lowercase hex characters — the same shape as the public form token (0601). */
export function newDriveShareToken(): string {
  return randomBytes(16).toString("hex");
}

/** What actually goes in drive_shares.token_hash. */
export function hashDriveShareToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** The link handed to a recipient. `baseUrl` comes from resolveAuthBaseURL(). */
export function driveShareUrl(baseUrl: string, token: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/s/${token}`;
}
