import { describe, expect, it } from "vitest";
import {
  isEnglish,
  normalizeEmail,
  normalizeLanguage,
  normalizeName,
  normalizePhone,
  normalizeStudentLabel,
  validateContactInput,
} from "./contacts";

describe("normalizeEmail", () => {
  it("lowercases and trims", () => {
    expect(normalizeEmail("  Pat.Parent@Example.COM ")).toBe("pat.parent@example.com");
  });
  it("rejects junk", () => {
    expect(normalizeEmail("not-an-email")).toBeNull();
    expect(normalizeEmail("a@b")).toBeNull();
    expect(normalizeEmail("two words@example.com")).toBeNull();
    expect(normalizeEmail("")).toBeNull();
    expect(normalizeEmail(42)).toBeNull();
    expect(normalizeEmail(`${"x".repeat(250)}@example.com`)).toBeNull();
  });
});

describe("normalizePhone", () => {
  it("null/empty means not provided", () => {
    expect(normalizePhone(null)).toBeNull();
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone("   ")).toBeNull();
  });
  it("strips formatting and keeps a leading +", () => {
    expect(normalizePhone("(555) 123-4567")).toBe("5551234567");
    expect(normalizePhone("+1 555 123 4567")).toBe("+15551234567");
  });
  it("returns undefined for invalid shapes", () => {
    expect(normalizePhone("123")).toBeUndefined();
    expect(normalizePhone("call me maybe")).toBeUndefined();
    expect(normalizePhone(12345)).toBeUndefined();
  });
});

describe("normalizeLanguage", () => {
  it("defaults empty to en", () => {
    expect(normalizeLanguage(null)).toBe("en");
    expect(normalizeLanguage("")).toBe("en");
  });
  it("normalizes the primary subtag", () => {
    expect(normalizeLanguage("EN")).toBe("en");
    expect(normalizeLanguage("es")).toBe("es");
    expect(normalizeLanguage("zh-Hans")).toBe("zh-Hans");
    expect(normalizeLanguage("PT-BR")).toBe("pt-BR");
  });
  it("rejects malformed tags", () => {
    expect(normalizeLanguage("english")).toBeNull();
    expect(normalizeLanguage("e")).toBeNull();
    expect(normalizeLanguage("en_US")).toBeNull();
    expect(normalizeLanguage("a".repeat(13))).toBeNull();
  });
});

describe("isEnglish", () => {
  it("treats en and en-* as English", () => {
    expect(isEnglish("en")).toBe(true);
    expect(isEnglish("en-GB")).toBe(true);
    expect(isEnglish("es")).toBe(false);
  });
});

describe("normalizeName / normalizeStudentLabel", () => {
  it("collapses whitespace", () => {
    expect(normalizeName("  Pat   Parent ")).toBe("Pat Parent");
    expect(normalizeStudentLabel("  Jordan   (Mech) ")).toBe("Jordan (Mech)");
  });
  it("name is required, label is not", () => {
    expect(normalizeName("")).toBeNull();
    expect(normalizeName("x".repeat(121))).toBeNull();
    expect(normalizeStudentLabel(undefined)).toBe("");
  });
});

describe("validateContactInput", () => {
  it("accepts a full payload", () => {
    const result = validateContactInput({
      name: "Pat Parent",
      email: "PAT@example.com",
      phone: "(555) 123-4567",
      preferredLanguage: "ES",
      studentLabel: "Jordan",
    });
    expect(result).toEqual({
      ok: true,
      contact: {
        name: "Pat Parent",
        email: "pat@example.com",
        phone: "5551234567",
        preferredLanguage: "es",
        studentLabel: "Jordan",
      },
    });
  });

  it("reports the first human-readable problem", () => {
    expect(validateContactInput({ name: "", email: "a@b.c" })).toMatchObject({ ok: false });
    expect(validateContactInput({ name: "Pat", email: "nope" })).toMatchObject({ ok: false });
    expect(
      validateContactInput({ name: "Pat", email: "a@b.co", phone: "abc" }),
    ).toMatchObject({ ok: false });
    expect(
      validateContactInput({ name: "Pat", email: "a@b.co", preferredLanguage: "english" }),
    ).toMatchObject({ ok: false });
  });

  it("defaults optional fields", () => {
    const result = validateContactInput({ name: "Pat", email: "a@b.co" });
    expect(result).toEqual({
      ok: true,
      contact: { name: "Pat", email: "a@b.co", phone: null, preferredLanguage: "en", studentLabel: "" },
    });
  });
});
