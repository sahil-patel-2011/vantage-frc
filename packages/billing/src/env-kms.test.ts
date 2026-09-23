import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EnvKeyKmsService, createKms, decryptSecret, encryptSecret } from "./index";

const key = () => randomBytes(32).toString("base64");

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("EnvKeyKmsService", () => {
  it("round-trips a secret through the envelope", async () => {
    const kms = new EnvKeyKmsService(key());
    const sealed = await encryptSecret("refresh-token-value", kms);
    expect(sealed.ciphertext).not.toContain("refresh-token-value");
    expect(sealed.kmsKeyId).toMatch(/^env-kms:v1:[0-9a-f]{12}$/);
    await expect(decryptSecret(sealed, kms)).resolves.toBe("refresh-token-value");
  });

  it("refuses anything but exactly 32 random bytes", () => {
    expect(() => new EnvKeyKmsService("short")).toThrow(/32 random bytes/);
    expect(() => new EnvKeyKmsService(randomBytes(16).toString("base64"))).toThrow(/32 random bytes/);
  });

  it("fails loudly under a different master key instead of decrypting garbage", async () => {
    const sealed = await encryptSecret("secret", new EnvKeyKmsService(key()));
    await expect(decryptSecret(sealed, new EnvKeyKmsService(key()))).rejects.toThrow(/KMS key mismatch/);
  });

  it("is what createKms uses in production when AWS KMS is not configured", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AWS_KMS_KEY_ID", "");
    vi.stubEnv("VANTAGE_KMS_MASTER_KEY", key());
    expect(createKms()).toBeInstanceOf(EnvKeyKmsService);
    vi.stubEnv("VANTAGE_KMS_MASTER_KEY", "");
    expect(() => createKms()).toThrow(/forbidden in production/);
  });
});
