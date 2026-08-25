import { describe, expect, it } from "vitest";
import { describeUserAgent, isValidPushEndpoint, parseSubscriptionInput } from "./subscription";

function base64Url(bytes: number): string {
  return Buffer.alloc(bytes, 7).toString("base64url");
}

const VALID = {
  endpoint: "https://fcm.googleapis.com/fcm/send/abc123",
  p256dh: base64Url(65),
  auth: base64Url(16),
};

describe("isValidPushEndpoint", () => {
  it("requires an absolute https URL", () => {
    expect(isValidPushEndpoint("https://updates.push.services.mozilla.com/wpush/v2/x")).toBe(true);
    expect(isValidPushEndpoint("http://insecure.example/push")).toBe(false);
    expect(isValidPushEndpoint("/relative")).toBe(false);
    expect(isValidPushEndpoint("")).toBe(false);
    expect(isValidPushEndpoint(42)).toBe(false);
  });

  it("rejects an endpoint longer than the column stores", () => {
    expect(isValidPushEndpoint(`https://push.example/${"x".repeat(1200)}`)).toBe(false);
  });
});

describe("parseSubscriptionInput", () => {
  it("accepts a well-formed browser subscription", () => {
    const result = parseSubscriptionInput(VALID, "Mozilla/5.0 (Windows NT 10.0) Chrome/131");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.endpoint).toBe(VALID.endpoint);
    expect(result.value.orgId).toBeNull();
    expect(result.value.userAgent).toContain("Chrome");
  });

  it("rejects keys of the wrong length instead of storing a row that can never encrypt", () => {
    expect(parseSubscriptionInput({ ...VALID, p256dh: base64Url(32) })).toMatchObject({ ok: false });
    expect(parseSubscriptionInput({ ...VALID, auth: base64Url(12) })).toMatchObject({ ok: false });
    expect(parseSubscriptionInput({ ...VALID, p256dh: "not base64!!" })).toMatchObject({ ok: false });
  });

  it("keeps a uuid orgId hint and refuses a malformed one", () => {
    const ok = parseSubscriptionInput({
      ...VALID,
      orgId: "5f1b0c4e-6a2d-4f3b-9c1e-8a7d6b5c4e3f",
    });
    expect(ok.ok && ok.value.orgId).toBe("5f1b0c4e-6a2d-4f3b-9c1e-8a7d6b5c4e3f");
    expect(parseSubscriptionInput({ ...VALID, orgId: "team-254" })).toMatchObject({ ok: false });
    // An explicitly absent org is fine — the subscription is user-owned.
    expect(parseSubscriptionInput({ ...VALID, orgId: null })).toMatchObject({ ok: true });
  });

  it("rejects a non-object body", () => {
    expect(parseSubscriptionInput("nope")).toMatchObject({ ok: false });
    expect(parseSubscriptionInput(null)).toMatchObject({ ok: false });
  });

  it("truncates a hostile user agent", () => {
    const result = parseSubscriptionInput(VALID, "A".repeat(5000));
    expect(result.ok && result.value.userAgent?.length).toBe(300);
  });
});

describe("describeUserAgent", () => {
  it("names the device the way the member would", () => {
    expect(describeUserAgent("Mozilla/5.0 (Windows NT 10.0) Chrome/131.0 Safari/537.36")).toBe(
      "Chrome on Windows",
    );
    expect(describeUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_4) Version/17.4 Safari/605.1")).toBe(
      "Safari on iOS",
    );
    expect(describeUserAgent("Mozilla/5.0 (Linux; Android 14) Chrome/131.0 Mobile Safari/537.36")).toBe(
      "Chrome on Android",
    );
    expect(describeUserAgent(null)).toBe("Unknown device");
  });
});
