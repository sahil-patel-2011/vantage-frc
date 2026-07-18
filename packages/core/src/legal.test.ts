import { describe, expect, it } from "vitest";
import { assertTermsAccepted, LEGAL_DOC_VERSION, LEGAL_EFFECTIVE_DATE } from "./legal";

describe("legal acceptance helpers", () => {
  it("publishes a 2026 document version", () => {
    expect(LEGAL_DOC_VERSION).toMatch(/^2026-/);
    expect(LEGAL_EFFECTIVE_DATE).toMatch(/2026/);
  });
  it("blocks proceed without explicit acceptance", () => {
    expect(() => assertTermsAccepted(true)).not.toThrow();
    expect(() => assertTermsAccepted(false)).toThrow(/Terms of Service and Privacy Policy/i);
    expect(() => assertTermsAccepted(undefined)).toThrow(/Terms of Service and Privacy Policy/i);
  });
});