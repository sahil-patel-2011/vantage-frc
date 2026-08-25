// Storage-node pairing primitives (server-only: node:crypto). Mirrors the CAD relay pairing
// code maths exactly — 8 chars from an unambiguous alphabet, sha256-hashed tokens, plaintext
// never stored.

import { createHash, randomBytes } from "node:crypto";

/** No I/O/0/1 — codes get read aloud in a noisy shop. */
export const PAIRING_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** Human pairing code, formatted XXXX-XXXX. */
export function generatePairingCode(): string {
  return Array.from(
    { length: 8 },
    (_, index) => (index === 4 ? "-" : "") + PAIRING_CODE_ALPHABET[randomBytes(1)[0]! % PAIRING_CODE_ALPHABET.length],
  ).join("");
}

/** Strip separators, uppercase, validate. Returns the bare 8-char code or null. */
export function normalizePairingCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const bare = raw.replace(/[\s-]/g, "").toUpperCase();
  if (bare.length !== 8) return null;
  for (const ch of bare) if (!PAIRING_CODE_ALPHABET.includes(ch)) return null;
  return bare;
}

export function hashSha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function newToken(): string {
  return randomBytes(32).toString("base64url");
}
