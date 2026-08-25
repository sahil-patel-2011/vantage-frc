/**
 * Web Push message encryption: RFC 8188 `aes128gcm` content coding with the
 * RFC 8291 key derivation. Implemented directly on node:crypto so the app does
 * not take a dependency for ~90 lines of HKDF.
 *
 * Body layout (RFC 8188 §2.1), single record:
 *   salt(16) | rs(4, big-endian) | idlen(1)=65 | as_public(65) | AES-GCM(record)
 * where record = plaintext | 0x02 (last-record padding delimiter).
 */
import { createCipheriv, createECDH, createHmac, randomBytes } from "node:crypto";
import { base64UrlDecode } from "./encode";

/** Push services cap a message at 4096 bytes of body; that leaves this much plaintext. */
export const MAX_PUSH_PAYLOAD_BYTES = 3993;

const RECORD_SIZE = 4096;
const KEY_INFO = Buffer.from("WebPush: info\0", "utf8");
const CEK_INFO = Buffer.from("Content-Encoding: aes128gcm\0", "utf8");
const NONCE_INFO = Buffer.from("Content-Encoding: nonce\0", "utf8");

export type PushKeys = {
  /** `p256dh` — the UA's uncompressed P-256 public key (65 bytes, base64url). */
  p256dh: string;
  /** `auth` — the UA's 16-byte auth secret (base64url). */
  auth: string;
};

function hkdfExtract(salt: Buffer, ikm: Buffer): Buffer {
  return createHmac("sha256", salt).update(ikm).digest();
}

function hkdfExpand(prk: Buffer, info: Buffer, length: number): Buffer {
  // Every derivation here is <= 32 bytes, so a single HMAC block (T(1)) suffices.
  if (length > 32) throw new Error("hkdfExpand: only one HMAC block is supported");
  const block = createHmac("sha256", prk)
    .update(Buffer.concat([info, Buffer.from([1])]))
    .digest();
  return block.subarray(0, length);
}

export type DerivedPushKeys = { contentEncryptionKey: Buffer; nonce: Buffer };

/**
 * RFC 8291 §3.4. `sharedSecret` is the raw ECDH output between the application
 * server key and the UA key; `senderPublicKey` / `receiverPublicKey` are the
 * uncompressed 65-byte forms, ordered receiver-then-sender inside key_info.
 */
export function derivePushKeys(input: {
  sharedSecret: Buffer;
  authSecret: Buffer;
  receiverPublicKey: Buffer;
  senderPublicKey: Buffer;
  salt: Buffer;
}): DerivedPushKeys {
  const keyInfo = Buffer.concat([KEY_INFO, input.receiverPublicKey, input.senderPublicKey]);
  const ikm = hkdfExpand(hkdfExtract(input.authSecret, input.sharedSecret), keyInfo, 32);
  const prk = hkdfExtract(input.salt, ikm);
  return {
    contentEncryptionKey: hkdfExpand(prk, CEK_INFO, 16),
    nonce: hkdfExpand(prk, NONCE_INFO, 12),
  };
}

export type EncryptedPushBody = {
  body: Buffer;
  /** The ephemeral application-server public key that was written into the header. */
  senderPublicKey: Buffer;
  salt: Buffer;
};

/**
 * Encrypt `payload` for one subscription. `options` exists only so tests can pin
 * the RFC 8291 example vector; production always uses fresh random material.
 */
export function encryptPushPayload(
  payload: string | Buffer,
  keys: PushKeys,
  options?: { salt?: Buffer; senderPrivateKey?: Buffer },
): EncryptedPushBody {
  const plaintext = Buffer.isBuffer(payload) ? payload : Buffer.from(payload, "utf8");
  if (plaintext.length > MAX_PUSH_PAYLOAD_BYTES) {
    throw new Error(
      `Push payload is ${plaintext.length} bytes; the aes128gcm limit is ${MAX_PUSH_PAYLOAD_BYTES}`,
    );
  }

  const receiverPublicKey = base64UrlDecode(keys.p256dh);
  if (receiverPublicKey.length !== 65 || receiverPublicKey[0] !== 0x04) {
    throw new Error("Subscription p256dh is not an uncompressed P-256 point");
  }
  const authSecret = base64UrlDecode(keys.auth);
  if (authSecret.length !== 16) {
    throw new Error("Subscription auth secret must be 16 bytes");
  }

  const ecdh = createECDH("prime256v1");
  if (options?.senderPrivateKey) ecdh.setPrivateKey(options.senderPrivateKey);
  else ecdh.generateKeys();
  const senderPublicKey = ecdh.getPublicKey();
  const sharedSecret = ecdh.computeSecret(receiverPublicKey);

  const salt = options?.salt ?? randomBytes(16);
  const { contentEncryptionKey, nonce } = derivePushKeys({
    sharedSecret,
    authSecret,
    receiverPublicKey,
    senderPublicKey,
    salt,
  });

  const cipher = createCipheriv("aes-128-gcm", contentEncryptionKey, nonce);
  const record = Buffer.concat([plaintext, Buffer.from([2])]);
  const ciphertext = Buffer.concat([cipher.update(record), cipher.final(), cipher.getAuthTag()]);

  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(RECORD_SIZE, 16);
  header.writeUInt8(senderPublicKey.length, 20);

  return {
    body: Buffer.concat([header, senderPublicKey, ciphertext]),
    senderPublicKey,
    salt,
  };
}

/** Parsed aes128gcm header — used by the round-trip test and by nothing in production. */
export function parseAes128GcmHeader(body: Buffer): {
  salt: Buffer;
  recordSize: number;
  senderPublicKey: Buffer;
  ciphertext: Buffer;
} {
  if (body.length < 21) throw new Error("aes128gcm body is too short for a header");
  const salt = body.subarray(0, 16);
  const recordSize = body.readUInt32BE(16);
  const idLength = body.readUInt8(20);
  const senderPublicKey = body.subarray(21, 21 + idLength);
  return { salt, recordSize, senderPublicKey, ciphertext: body.subarray(21 + idLength) };
}
