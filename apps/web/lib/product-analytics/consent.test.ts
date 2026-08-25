import { describe, expect, it } from "vitest";
import {
  ANALYTICS_CONSENT_COOKIE,
  ANALYTICS_CONSENT_VERSION,
  consentCookieAttributes,
  hasAnalyticsConsent,
  needsConsentDecision,
  parseConsent,
  readCookie,
  requestHasAnalyticsConsent,
  serializeConsent,
} from "./consent";

describe("consent cookie value", () => {
  it("round-trips a choice", () => {
    expect(parseConsent(serializeConsent("granted"))).toEqual({
      choice: "granted",
      version: ANALYTICS_CONSENT_VERSION,
    });
    expect(parseConsent(serializeConsent("denied"))).toEqual({
      choice: "denied",
      version: ANALYTICS_CONSENT_VERSION,
    });
  });

  it("treats anything unrecognised as no choice at all", () => {
    for (const value of [null, undefined, "", "   ", "yes", "granted", "granted.", "granted.x", "true.1", "1"]) {
      expect(parseConsent(value), `parse(${String(value)})`).toBeNull();
    }
  });
});

describe("hasAnalyticsConsent", () => {
  it("is true only for an explicit grant at the current version", () => {
    expect(hasAnalyticsConsent(`granted.${ANALYTICS_CONSENT_VERSION}`)).toBe(true);
  });

  it("is false when there is no cookie", () => {
    expect(hasAnalyticsConsent(null)).toBe(false);
    expect(hasAnalyticsConsent(undefined)).toBe(false);
    expect(hasAnalyticsConsent("")).toBe(false);
  });

  it("is false for a decline", () => {
    expect(hasAnalyticsConsent(`denied.${ANALYTICS_CONSENT_VERSION}`)).toBe(false);
  });

  it("is false for a grant recorded against different terms", () => {
    // A yes given to an older disclosure is not a yes to this one.
    expect(hasAnalyticsConsent(`granted.${ANALYTICS_CONSENT_VERSION + 1}`)).toBe(false);
    expect(hasAnalyticsConsent("granted.0")).toBe(false);
  });

  it("is false for a hand-edited or corrupted value", () => {
    expect(hasAnalyticsConsent("granted.1; denied.1")).toBe(false);
    expect(hasAnalyticsConsent("GRANTED.1")).toBe(false);
    expect(hasAnalyticsConsent("granted.1x")).toBe(false);
  });
});

describe("needsConsentDecision", () => {
  it("asks when nobody has answered", () => {
    expect(needsConsentDecision(null)).toBe(true);
    expect(needsConsentDecision("garbage")).toBe(true);
  });

  it("stops asking after either answer", () => {
    expect(needsConsentDecision(`granted.${ANALYTICS_CONSENT_VERSION}`)).toBe(false);
    // A decline is a real answer. Re-asking after a "no" is nagging.
    expect(needsConsentDecision(`denied.${ANALYTICS_CONSENT_VERSION}`)).toBe(false);
  });

  it("asks again when the terms change version", () => {
    expect(needsConsentDecision("granted.0")).toBe(true);
    expect(needsConsentDecision("denied.0")).toBe(true);
  });
});

describe("readCookie", () => {
  it("finds a cookie among others", () => {
    const header = `vantage-theme=dark; ${ANALYTICS_CONSENT_COOKIE}=granted.1; other=1`;
    expect(readCookie(header, ANALYTICS_CONSENT_COOKIE)).toBe("granted.1");
  });

  it("does not match a cookie whose name merely ends the same way", () => {
    const header = `not-${ANALYTICS_CONSENT_COOKIE}=granted.1`;
    expect(readCookie(header, ANALYTICS_CONSENT_COOKIE)).toBeNull();
  });

  it("returns null for a missing header or cookie", () => {
    expect(readCookie(null, ANALYTICS_CONSENT_COOKIE)).toBeNull();
    expect(readCookie("", ANALYTICS_CONSENT_COOKIE)).toBeNull();
    expect(readCookie("a=1", ANALYTICS_CONSENT_COOKIE)).toBeNull();
  });
});

describe("requestHasAnalyticsConsent", () => {
  const withCookie = (value: string | null) => new Headers(value === null ? {} : { cookie: value });

  it("is the server-side gate and refuses a request with no cookie", () => {
    expect(requestHasAnalyticsConsent(withCookie(null))).toBe(false);
    expect(requestHasAnalyticsConsent(withCookie("vantage-theme=dark"))).toBe(false);
  });

  it("refuses a declined request even though it is well formed", () => {
    expect(requestHasAnalyticsConsent(withCookie(`${ANALYTICS_CONSENT_COOKIE}=denied.1`))).toBe(false);
  });

  it("allows a granted request at the current version", () => {
    expect(
      requestHasAnalyticsConsent(
        withCookie(`vantage-theme=dark; ${ANALYTICS_CONSENT_COOKIE}=granted.${ANALYTICS_CONSENT_VERSION}`),
      ),
    ).toBe(true);
  });
});

describe("consentCookieAttributes", () => {
  it("is SameSite=Lax and path-wide, and Secure only over https", () => {
    expect(consentCookieAttributes(true)).toContain("Secure");
    expect(consentCookieAttributes(false)).not.toContain("Secure");
    for (const secure of [true, false]) {
      const attrs = consentCookieAttributes(secure);
      expect(attrs).toContain("Path=/");
      expect(attrs).toContain("SameSite=Lax");
      expect(attrs).toMatch(/Max-Age=\d+/);
    }
  });
});
