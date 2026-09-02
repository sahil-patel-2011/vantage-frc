// Self-serve exit-interview invites — server-side token minting and hashing.
// The link carries an opaque token; only its sha256 is stored (migration
// 0501). Copies the parent-view capability-token shape from
// lib/parent-comms/tokens.ts. Everything client-safe (paths, validation, state
// classification) lives in ./invite-shared and is re-exported here.

import { createHash, randomBytes } from "node:crypto";

export * from "./invite-shared";

export function newExitInviteToken(): string {
  return randomBytes(24).toString("base64url");
}

/** The only thing the database ever sees. */
export function hashExitInviteToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
