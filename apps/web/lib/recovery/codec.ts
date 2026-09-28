import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import type { KeyManagementService } from "@vantage/billing";

export const RECOVERY_CELL_SIZE = 40_000;
export type RecoveryEnvelope = {
  version: 1; id: string; keyId: string; wrappedKey: string; nonce: string; tag: string;
  sha256: string; bytes: number; parts: number;
};
export type RecoveryPart = { index: number; value: string };
/** The input is text, including raw PostgreSQL JSON text. Never parse numbers through JS. */
export async function encodeRecovery(id: string, text: string, kms: KeyManagementService) {
  const key = await kms.generateDataKey();
  try {
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key.plaintext, nonce);
    cipher.setAAD(Buffer.from(`vantage-recovery:1:${id}`));
    const compressed = gzipSync(Buffer.from(text, "utf8"));
    const ciphertext = Buffer.concat([cipher.update(compressed), cipher.final()]);
    const base64 = ciphertext.toString("base64");
    const parts: RecoveryPart[] = [];
    for (let offset = 0; offset < base64.length; offset += RECOVERY_CELL_SIZE) parts.push({ index: parts.length, value: base64.slice(offset, offset + RECOVERY_CELL_SIZE) });
    const envelope: RecoveryEnvelope = { version: 1, id, keyId: kms.keyId, wrappedKey: Buffer.from(key.encrypted).toString("base64"), nonce: nonce.toString("base64"), tag: cipher.getAuthTag().toString("base64"), sha256: createHash("sha256").update(ciphertext).digest("hex"), bytes: Buffer.byteLength(text), parts: parts.length };
    return { envelope, parts };
  } finally { key.plaintext.fill(0); }
}
export async function decodeRecovery(envelope: RecoveryEnvelope, parts: readonly RecoveryPart[], kms: KeyManagementService): Promise<string> {
  if (envelope.version !== 1 || envelope.keyId !== kms.keyId) throw new Error("Recovery key or version mismatch.");
  const ordered = [...parts].sort((a, b) => a.index - b.index);
  if (ordered.length !== envelope.parts || ordered.some((part, index) => part.index !== index || !/^[A-Za-z0-9+/]*={0,2}$/.test(part.value))) throw new Error("Recovery parts are missing, duplicated, or malformed.");
  const ciphertext = Buffer.from(ordered.map((part) => part.value).join(""), "base64");
  if (createHash("sha256").update(ciphertext).digest("hex") !== envelope.sha256) throw new Error("Recovery integrity check failed.");
  const key = await kms.decryptDataKey(Buffer.from(envelope.wrappedKey, "base64"));
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.nonce, "base64"));
    decipher.setAAD(Buffer.from(`vantage-recovery:1:${envelope.id}`));
    decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
    const text = gunzipSync(Buffer.concat([decipher.update(ciphertext), decipher.final()]));
    if (text.length !== envelope.bytes) throw new Error("Recovery length check failed.");
    return text.toString("utf8");
  } finally { key.fill(0); }
}
