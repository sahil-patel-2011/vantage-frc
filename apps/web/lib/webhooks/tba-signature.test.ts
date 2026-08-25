import { describe, expect, it } from "vitest";
import { computeTbaHmac, verifyTbaWebhook } from "./tba-signature";

const SECRET = "s3cr3t-firehose-key";
const BODY = JSON.stringify({
  message_type: "upcoming_match",
  message_data: { event_key: "2026mil", match_key: "2026mil_qm42" },
});

describe("verifyTbaWebhook", () => {
  it("accepts a body signed with the configured secret", () => {
    const header = computeTbaHmac(BODY, SECRET);
    expect(verifyTbaWebhook({ rawBody: BODY, header, secret: SECRET })).toEqual({ ok: true });
  });

  it("accepts an uppercase or sha256-prefixed header", () => {
    const digest = computeTbaHmac(BODY, SECRET);
    expect(verifyTbaWebhook({ rawBody: BODY, header: digest.toUpperCase(), secret: SECRET }).ok).toBe(true);
    expect(verifyTbaWebhook({ rawBody: BODY, header: `sha256=${digest}`, secret: SECRET }).ok).toBe(true);
  });

  it("rejects a body that was modified after signing", () => {
    const header = computeTbaHmac(BODY, SECRET);
    const tampered = BODY.replace("qm42", "qm43");
    const result = verifyTbaWebhook({ rawBody: tampered, header, secret: SECRET });
    expect(result).toEqual({ ok: false, status: 401, reason: expect.stringContaining("does not match") });
  });

  it("rejects a signature made with a different secret", () => {
    const header = computeTbaHmac(BODY, "someone-elses-secret");
    expect(verifyTbaWebhook({ rawBody: BODY, header, secret: SECRET }).ok).toBe(false);
  });

  it("rejects a missing or non-hex header", () => {
    expect(verifyTbaWebhook({ rawBody: BODY, header: null, secret: SECRET })).toMatchObject({
      status: 401,
    });
    expect(verifyTbaWebhook({ rawBody: BODY, header: "not-a-digest", secret: SECRET })).toMatchObject({
      status: 401,
    });
    // Right shape, wrong length — must not be padded into a match.
    expect(verifyTbaWebhook({ rawBody: BODY, header: "abcdef", secret: SECRET })).toMatchObject({
      status: 401,
    });
  });

  it("reports setup_required (503) instead of accepting when no secret is configured", () => {
    const result = verifyTbaWebhook({ rawBody: BODY, header: computeTbaHmac(BODY, SECRET), secret: null });
    expect(result).toMatchObject({ ok: false, status: 503 });
  });

  it("is sensitive to whitespace, so verification must run on the raw body", () => {
    const header = computeTbaHmac(BODY, SECRET);
    const reserialized = JSON.stringify(JSON.parse(BODY), null, 2);
    expect(verifyTbaWebhook({ rawBody: reserialized, header, secret: SECRET }).ok).toBe(false);
  });
});
