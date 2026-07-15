import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, LocalKmsService } from "../src";

describe("BYO key envelope encryption", () => {
  it("round-trips without storing plaintext", async () => {
    const kms = new LocalKmsService("unit-test-master-key");
    const encrypted = await encryptSecret("sk-test-sensitive", kms);
    expect(JSON.stringify(encrypted)).not.toContain("sk-test-sensitive");
    await expect(decryptSecret(encrypted, kms)).resolves.toBe("sk-test-sensitive");
  });

  it("rejects a different wrapping key", async () => {
    const encrypted = await encryptSecret("secret", new LocalKmsService("first"));
    await expect(decryptSecret(encrypted, new LocalKmsService("second"))).rejects.toThrow();
  });
});
