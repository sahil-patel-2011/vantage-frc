import { describe, expect, it } from "vitest";
import {
  ENROLL_SCAN_ACTION,
  MAX_ENROLL_LABEL_LENGTH,
  canEnrollScanCodes,
  enrollConflictMessage,
  enrollSuccessPayload,
  isEnrollScanBody,
  isMissingScanCodeSchema,
  isScanCodeUniqueViolation,
  normalizeEnrollLabel,
  parseEnrollScanAction,
} from "./enroll";

const ORG = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";

const enroll = (extra: Record<string, unknown> = {}) =>
  parseEnrollScanAction({
    action: ENROLL_SCAN_ACTION,
    orgId: ORG,
    userId: USER,
    code: "A12345",
    ...extra,
  });

describe("parseEnrollScanAction", () => {
  it("normalizes the keyboard-wedge payload the scanner actually types", () => {
    // Enrollment and scan must normalize identically or a valid card never matches.
    expect(enroll({ code: "\ta12345\r\n" }).code).toBe("A12345");
  });

  it("defaults the kind to student_id rather than failing a missing field", () => {
    expect(enroll().codeKind).toBe("student_id");
  });

  it("accepts barcode and manual kinds", () => {
    expect(enroll({ codeKind: "barcode" }).codeKind).toBe("barcode");
    expect(enroll({ codeKind: "manual" }).codeKind).toBe("manual");
  });

  it("rejects an unknown kind", () => {
    expect(() => enroll({ codeKind: "fingerprint" })).toThrow(/invalid/i);
  });

  it("refuses an email as a scan identifier", () => {
    expect(() => enroll({ code: "maya@team.org" })).toThrow(/card or student ID/i);
  });

  it("requires a real org and member id", () => {
    expect(() => enroll({ orgId: "nope" })).toThrow(/Organization is invalid/i);
    expect(() => enroll({ userId: "" })).toThrow(/Member is required/i);
    expect(() => enroll({ userId: "not-a-uuid" })).toThrow(/Member is invalid/i);
  });

  it("trims an over-long label to the column width", () => {
    const action = enroll({ label: "x".repeat(200) });
    expect(action.label).toHaveLength(MAX_ENROLL_LABEL_LENGTH);
  });

  it("treats a blank label as empty rather than inventing one", () => {
    expect(enroll({ label: "   " }).label).toBe("");
    expect(enroll().label).toBe("");
  });

  it("rejects an empty or too-short code", () => {
    expect(() => enroll({ code: "" })).toThrow(/scan or type/i);
    expect(() => enroll({ code: "AB" })).toThrow(/at least/i);
  });

  it("rejects a different action rather than guessing intent", () => {
    expect(() => parseEnrollScanAction({ action: "clock_in", orgId: ORG, userId: USER, code: "A12345" })).toThrow(
      /Unsupported/i,
    );
  });
});

describe("isEnrollScanBody", () => {
  it("recognizes enroll-scan so the hours route can branch before parseBuildHoursAction", () => {
    expect(isEnrollScanBody({ action: "enroll-scan", orgId: ORG })).toBe(true);
    expect(isEnrollScanBody({ action: "clock_in", orgId: ORG })).toBe(false);
    expect(isEnrollScanBody(null)).toBe(false);
    expect(isEnrollScanBody("enroll-scan")).toBe(false);
  });
});

describe("canEnrollScanCodes", () => {
  it("allows only owner and admin — the 0457 insert policy", () => {
    expect(canEnrollScanCodes("owner")).toBe(true);
    expect(canEnrollScanCodes("admin")).toBe(true);
    expect(canEnrollScanCodes("member")).toBe(false);
    expect(canEnrollScanCodes("mentor")).toBe(false);
    expect(canEnrollScanCodes(null)).toBe(false);
  });
});

describe("enrollConflictMessage", () => {
  it("names the other member without echoing the raw code", () => {
    expect(enrollConflictMessage("Maya Chen")).toBe("That code is already enrolled to Maya Chen.");
    expect(enrollConflictMessage(null)).toBe("That code is already enrolled to another member.");
    expect(enrollConflictMessage("  ")).toBe("That code is already enrolled to another member.");
  });
});

describe("enrollSuccessPayload", () => {
  it("returns a masked tail, never the full student ID", () => {
    const payload = enrollSuccessPayload("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "0041289");
    expect(payload.maskedCode).toBe("••••1289");
    expect(payload.maskedCode).not.toContain("004");
    expect(payload).not.toHaveProperty("code");
    expect(payload).not.toHaveProperty("totalHours");
  });
});

describe("normalizeEnrollLabel", () => {
  it("trims and caps at the migration CHECK", () => {
    expect(normalizeEnrollLabel("  blue lanyard  ")).toBe("blue lanyard");
    expect(normalizeEnrollLabel("x".repeat(81))).toHaveLength(MAX_ENROLL_LABEL_LENGTH);
  });
});

describe("schema / unique probes", () => {
  it("flags a missing member_scan_codes table as setup-required, not a crash", () => {
    expect(isMissingScanCodeSchema(Object.assign(new Error("missing"), { code: "42P01" }))).toBe(true);
    expect(isMissingScanCodeSchema(Object.assign(new Error("no column"), { code: "42703" }))).toBe(true);
    expect(isMissingScanCodeSchema(new Error('relation "member_scan_codes" does not exist'))).toBe(true);
    expect(isMissingScanCodeSchema(new Error("duplicate key"))).toBe(false);
  });

  it("recognizes a unique-code race so the route can answer 409", () => {
    expect(isScanCodeUniqueViolation(Object.assign(new Error("dup"), { code: "23505" }))).toBe(true);
    expect(isScanCodeUniqueViolation(new Error("dup"))).toBe(false);
  });
});
