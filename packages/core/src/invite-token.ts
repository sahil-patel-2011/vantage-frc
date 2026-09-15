import { createHash, randomBytes } from "node:crypto";

/** Raw invite / join tokens are 32-byte base64url (typically 43 chars). */
export const INVITE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;

export function isInviteTokenShape(token: string | null | undefined): token is string {
  return Boolean(token && INVITE_TOKEN_PATTERN.test(token.trim()));
}

export function hashInviteToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function createInviteToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashInviteToken(token) };
}
