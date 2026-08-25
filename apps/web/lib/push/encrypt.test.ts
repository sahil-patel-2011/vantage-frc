import { createDecipheriv, createECDH } from "node:crypto";
import { describe, expect, it } from "vitest";
import { base64UrlDecode, base64UrlEncode } from "./encode";
import {
  MAX_PUSH_PAYLOAD_BYTES,
  derivePushKeys,
  encryptPushPayload,
  parseAes128GcmHeader,
} from "./encrypt";

/**
 * RFC 8291 §5 "Push Message Encryption Example". Pinning this vector is the whole
 * reason we can ship our own aes128gcm instead of pulling in a dependency: if the
 * HKDF info strings, the key_info ordering, or the header layout ever drift, the
 * bytes stop matching a published example rather than silently producing messages
 * that every push service rejects.
 */
const RFC8291 = {
  plaintext: "When I grow up, I want to be a watermelon",
  uaPublic: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  uaPrivate: "q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94",
  authSecret: "BTBZMqHH6r4Tts7J_aSIgg",
  asPrivate: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
  asPublic: "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
  salt: "DGv6ra1nlYgDCS1FRnbzlw",
  // header = salt(16) | rs=4096 (00 00 10 00) | idlen=65 (0x41) | as_public(65)
  body:
    "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYW" +
    "AmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgS" +
    "xsj_Qulcy4a-fN",
};

/** The user-agent half of RFC 8291: derive from the header and open the record. */
function decryptAsUserAgent(body: Buffer, uaPrivate: Buffer, authSecret: Buffer): string {
  const { salt, senderPublicKey, ciphertext } = parseAes128GcmHeader(body);
  const ecdh = createECDH("prime256v1");
  ecdh.setPrivateKey(uaPrivate);
  const { contentEncryptionKey, nonce } = derivePushKeys({
    sharedSecret: ecdh.computeSecret(senderPublicKey),
    authSecret,
    receiverPublicKey: ecdh.getPublicKey(),
    senderPublicKey,
    salt,
  });
  const tag = ciphertext.subarray(ciphertext.length - 16);
  const decipher = createDecipheriv("aes-128-gcm", contentEncryptionKey, nonce);
  decipher.setAuthTag(tag);
  const record = Buffer.concat([
    decipher.update(ciphertext.subarray(0, ciphertext.length - 16)),
    decipher.final(),
  ]);
  // Strip the 0x02 last-record padding delimiter.
  return record.subarray(0, record.length - 1).toString("utf8");
}

describe("encryptPushPayload", () => {
  it("reproduces the RFC 8291 example vector byte for byte", () => {
    const result = encryptPushPayload(
      RFC8291.plaintext,
      { p256dh: RFC8291.uaPublic, auth: RFC8291.authSecret },
      { salt: base64UrlDecode(RFC8291.salt), senderPrivateKey: base64UrlDecode(RFC8291.asPrivate) },
    );
    expect(base64UrlEncode(result.senderPublicKey)).toBe(RFC8291.asPublic);
    expect(base64UrlEncode(result.body)).toBe(RFC8291.body);
  });

  it("writes a 21-byte aes128gcm header with rs=4096 and a 65-byte key id", () => {
    const result = encryptPushPayload("hello", {
      p256dh: RFC8291.uaPublic,
      auth: RFC8291.authSecret,
    });
    const header = parseAes128GcmHeader(result.body);
    expect(header.salt).toHaveLength(16);
    expect(header.recordSize).toBe(4096);
    expect(header.senderPublicKey).toHaveLength(65);
    expect(header.senderPublicKey[0]).toBe(0x04);
  });

  it("round-trips a real payload back to the subscribing user agent", () => {
    const result = encryptPushPayload(
      JSON.stringify({ title: "Q31 in 7 minutes", url: "/scouting" }),
      { p256dh: RFC8291.uaPublic, auth: RFC8291.authSecret },
    );
    const decrypted = decryptAsUserAgent(
      result.body,
      base64UrlDecode(RFC8291.uaPrivate),
      base64UrlDecode(RFC8291.authSecret),
    );
    expect(JSON.parse(decrypted)).toEqual({ title: "Q31 in 7 minutes", url: "/scouting" });
  });

  it("uses fresh salt and ephemeral keys on every call", () => {
    const keys = { p256dh: RFC8291.uaPublic, auth: RFC8291.authSecret };
    const a = encryptPushPayload("same text", keys);
    const b = encryptPushPayload("same text", keys);
    expect(a.salt.equals(b.salt)).toBe(false);
    expect(a.senderPublicKey.equals(b.senderPublicKey)).toBe(false);
    expect(a.body.equals(b.body)).toBe(false);
  });

  it("refuses malformed subscription keys instead of sending garbage", () => {
    expect(() =>
      encryptPushPayload("x", { p256dh: base64UrlEncode(Buffer.alloc(65)), auth: RFC8291.authSecret }),
    ).toThrow(/uncompressed P-256/);
    expect(() =>
      encryptPushPayload("x", { p256dh: RFC8291.uaPublic, auth: base64UrlEncode(Buffer.alloc(8)) }),
    ).toThrow(/16 bytes/);
  });

  it("refuses payloads past the aes128gcm record limit", () => {
    expect(() =>
      encryptPushPayload("a".repeat(MAX_PUSH_PAYLOAD_BYTES + 1), {
        p256dh: RFC8291.uaPublic,
        auth: RFC8291.authSecret,
      }),
    ).toThrow(/aes128gcm limit/);
  });
});
