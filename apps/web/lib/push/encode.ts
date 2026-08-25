/** base64url helpers shared by the VAPID signer and the aes128gcm content encoder. */

export function base64UrlEncode(input: Buffer | Uint8Array): string {
  return Buffer.from(input).toString("base64url");
}

/**
 * Accepts base64url or standard base64 (push subscriptions round-trip through
 * JSON.stringify in a lot of browsers and some libraries emit padded base64).
 */
export function base64UrlDecode(input: string): Buffer {
  const normalized = input.trim().replaceAll("-", "+").replaceAll("_", "/");
  return Buffer.from(normalized, "base64");
}

/** True when the string decodes to exactly `bytes` bytes. */
export function isBase64UrlOfLength(input: string, bytes: number): boolean {
  if (!input || !/^[A-Za-z0-9_+/=-]+$/.test(input.trim())) return false;
  return base64UrlDecode(input).length === bytes;
}
