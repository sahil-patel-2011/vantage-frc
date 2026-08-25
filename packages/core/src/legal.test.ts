import { describe, expect, it } from "vitest";
import {
  assertLegalAccepted,
  BOTH_MISSING_MESSAGE,
  legalAcceptanceRequired,
  LEGAL_DOC_VERSION,
  LEGAL_EFFECTIVE_DATE,
  PRIVACY_MISSING_MESSAGE,
  recordLegalAcceptance,
  TERMS_MISSING_MESSAGE,
} from "./legal";

describe("legal", () => {
  it("exposes one version string for both documents", () => {
    expect(LEGAL_DOC_VERSION).toMatch(/^2026-/);
    expect(LEGAL_EFFECTIVE_DATE).toContain("2026");
  });

  it("accepts only when both flags are explicitly true", () => {
    expect(() => assertLegalAccepted({ termsAccepted: true, privacyAccepted: true })).not.toThrow();
  });

  it("names the Terms of Service when only privacy was accepted", () => {
    expect(() => assertLegalAccepted({ termsAccepted: false, privacyAccepted: true })).toThrow(
      TERMS_MISSING_MESSAGE,
    );
    expect(() => assertLegalAccepted({ privacyAccepted: true })).toThrow(TERMS_MISSING_MESSAGE);
  });

  it("names the Privacy Policy when only terms were accepted", () => {
    expect(() => assertLegalAccepted({ termsAccepted: true, privacyAccepted: false })).toThrow(
      PRIVACY_MISSING_MESSAGE,
    );
    expect(() => assertLegalAccepted({ termsAccepted: true })).toThrow(PRIVACY_MISSING_MESSAGE);
  });

  it("names both when neither was accepted", () => {
    expect(() => assertLegalAccepted({})).toThrow(BOTH_MISSING_MESSAGE);
    expect(() => assertLegalAccepted({ termsAccepted: false, privacyAccepted: false })).toThrow(
      BOTH_MISSING_MESSAGE,
    );
  });

  it("rejects truthy non-boolean values", () => {
    expect(() =>
      assertLegalAccepted({ termsAccepted: "true", privacyAccepted: 1 }),
    ).toThrow(BOTH_MISSING_MESSAGE);
  });

  it("still requires consent when only the 0163 terms timestamp exists", () => {
    expect(
      legalAcceptanceRequired({ termsAcceptedAt: "2026-07-01T00:00:00Z", privacyAcceptedAt: null }),
    ).toBe(true);
    expect(legalAcceptanceRequired({ termsAcceptedAt: null, privacyAcceptedAt: null })).toBe(true);
    expect(
      legalAcceptanceRequired({
        termsAcceptedAt: "2026-07-01T00:00:00Z",
        privacyAcceptedAt: "2026-07-01T00:00:00Z",
      }),
    ).toBe(false);
  });
});

describe("recordLegalAcceptance", () => {
  function fakeClient() {
    const calls: { sql: string; params: unknown[] }[] = [];
    return {
      calls,
      client: {
        query: async (sql: string, params: unknown[]) => {
          calls.push({ sql, params });
          return { rows: [], rowCount: 1 };
        },
      },
    };
  }

  it("writes both timestamps and both versions in one statement", async () => {
    const { calls, client } = fakeClient();
    await recordLegalAcceptance(client as never, "11111111-1111-1111-1111-111111111111");

    expect(calls).toHaveLength(1);
    const first = calls[0];
    if (!first) throw new Error("expected one query");
    const { sql } = first;
    expect(sql).toMatch(/terms_accepted_at/);
    expect(sql).toMatch(/terms_version/);
    expect(sql).toMatch(/privacy_accepted_at/);
    expect(sql).toMatch(/privacy_version/);
  });

  it("records LEGAL_DOC_VERSION for both documents by default", async () => {
    const { calls, client } = fakeClient();
    await recordLegalAcceptance(client as never, "11111111-1111-1111-1111-111111111111");

    // One version param ($2) is reused for terms_version and privacy_version,
    // so the two documents can never drift to different recorded versions.
    expect(calls[0]?.params).toEqual([
      "11111111-1111-1111-1111-111111111111",
      LEGAL_DOC_VERSION,
    ]);
  });

  it("uses parameters rather than string-concatenated SQL", async () => {
    const { calls, client } = fakeClient();
    await recordLegalAcceptance(client as never, "22222222-2222-2222-2222-222222222222");

    expect(calls[0]?.sql).toContain("$1::uuid");
    expect(calls[0]?.sql).not.toContain("22222222-2222-2222-2222-222222222222");
  });
});
