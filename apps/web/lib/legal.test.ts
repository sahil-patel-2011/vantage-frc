import { describe, expect, it } from "vitest";
import { legalConsentComplete, legalConsentMessage } from "./legal";

describe("legalConsentComplete", () => {
  it("requires both boxes", () => {
    expect(legalConsentComplete({ terms: true, privacy: true })).toBe(true);
    expect(legalConsentComplete({ terms: true, privacy: false })).toBe(false);
    expect(legalConsentComplete({ terms: false, privacy: true })).toBe(false);
    expect(legalConsentComplete({ terms: false, privacy: false })).toBe(false);
  });
});

describe("legalConsentMessage", () => {
  it("names the missing document", () => {
    expect(legalConsentMessage({ terms: false, privacy: true })).toMatch(/Terms of Service/);
    expect(legalConsentMessage({ terms: false, privacy: true })).not.toMatch(/Privacy Policy/);
    expect(legalConsentMessage({ terms: true, privacy: false })).toMatch(/Privacy Policy/);
    expect(legalConsentMessage({ terms: true, privacy: false })).not.toMatch(/Terms of Service/);
  });

  it("names both when neither is ticked", () => {
    const message = legalConsentMessage({ terms: false, privacy: false });
    expect(message).toMatch(/Terms of Service/);
    expect(message).toMatch(/Privacy Policy/);
  });

  it("is null once both are ticked", () => {
    expect(legalConsentMessage({ terms: true, privacy: true })).toBeNull();
  });
});
