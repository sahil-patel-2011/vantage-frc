import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { isWebhookToken, newWebhookSecret, newWebhookToken, verifyGitHubSignature } from "./webhook-signature";

describe("verifyGitHubSignature", () => {
  const secret = "s3cret";
  const body = '{"action":"opened","number":7}';
  const signature = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

  it("accepts the signature GitHub computes over the raw body", () => {
    expect(verifyGitHubSignature(body, signature, secret)).toBe(true);
  });

  it("refuses a different body, a different secret, and missing or malformed headers", () => {
    expect(verifyGitHubSignature(`${body} `, signature, secret)).toBe(false);
    expect(verifyGitHubSignature(body, signature, "other")).toBe(false);
    expect(verifyGitHubSignature(body, null, secret)).toBe(false);
    expect(verifyGitHubSignature(body, "sha1=abc", secret)).toBe(false);
    expect(verifyGitHubSignature(body, signature, "")).toBe(false);
  });
});

describe("webhook tokens and secrets", () => {
  it("makes 43-character URL tokens and 64-hex-character secrets", () => {
    const token = newWebhookToken();
    expect(isWebhookToken(token)).toBe(true);
    expect(newWebhookToken()).not.toBe(token);
    expect(newWebhookSecret()).toMatch(/^[0-9a-f]{64}$/);
    expect(isWebhookToken("short")).toBe(false);
  });
});
