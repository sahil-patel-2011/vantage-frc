// Mentor enroll-scan path — attach a barcode / student-ID / RFID payload to a
// member so the shop kiosk can resolve it. Framework-free: shared by the hours
// API route, the hours-page enroll form, and unit tests.
//
// Writes `member_scan_codes` (migration 0457). The identifier is never an email
// (minors'-data minimalism). Enrollment does not clock anyone in or invent hour
// totals — it only stores the code the scanner will type later.

import {
  maskScanCode,
  requireScanCode,
  scanCodeKind,
  type ScanCodeKind,
} from "./scan-codes";

export const ENROLL_SCAN_ACTION = "enroll-scan";

export const MAX_ENROLL_LABEL_LENGTH = 80;

export const ENROLL_SCAN_SETUP_MESSAGE =
  "Scan-in kiosk tables are not migrated yet — run migration 0457_hours_kiosk_scan.sql, then reload.";

export type EnrollScanAction = {
  action: typeof ENROLL_SCAN_ACTION;
  orgId: string;
  userId: string;
  code: string;
  codeKind: ScanCodeKind;
  label: string;
};

export type EnrollScanResult = {
  id: string;
  maskedCode: string;
};

function requiredText(value: unknown, label: string, max: number) {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`${label} is required`);
  if (text.length > max) throw new Error(`${label} must be ${max} characters or fewer`);
  return text;
}

function uuid(value: unknown, label: string) {
  const text = requiredText(value, label, 64);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)) {
    throw new Error(`${label} is invalid`);
  }
  return text;
}

/** Human label for the mentor UI. Truncated to the column CHECK, never invented. */
export function normalizeEnrollLabel(raw: unknown): string {
  return String(raw ?? "").trim().slice(0, MAX_ENROLL_LABEL_LENGTH);
}

/** Owner/admin only — matches the 0457 insert policy. Mentors in this product are those roles. */
export function canEnrollScanCodes(role: string | null | undefined): boolean {
  return role === "owner" || role === "admin";
}

/** True when the request body is the enroll-scan action (even if the rest is invalid). */
export function isEnrollScanBody(input: unknown): boolean {
  if (!input || typeof input !== "object" || Array.isArray(input)) return false;
  return String((input as Record<string, unknown>).action ?? "").trim() === ENROLL_SCAN_ACTION;
}

export function parseEnrollScanAction(input: unknown): EnrollScanAction {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Invalid hours action");
  const body = input as Record<string, unknown>;
  const action = requiredText(body.action, "Action", 40);
  if (action !== ENROLL_SCAN_ACTION) throw new Error("Unsupported hours action");

  return {
    action: ENROLL_SCAN_ACTION,
    orgId: uuid(body.orgId, "Organization"),
    userId: uuid(body.userId, "Member"),
    code: requireScanCode(body.code),
    codeKind: scanCodeKind(body.codeKind),
    label: normalizeEnrollLabel(body.label),
  };
}

/** 409 copy — names the other member, never echoes the raw student ID. */
export function enrollConflictMessage(existingName: string | null | undefined): string {
  return `That code is already enrolled to ${existingName?.trim() || "another member"}.`;
}

export function enrollSuccessPayload(id: string, code: string): EnrollScanResult {
  return { id, maskedCode: maskScanCode(code) };
}

/**
 * The enroll table landed in 0457. A deployment that has not run it yet must
 * degrade to "configure X", never crash the hours page.
 */
export function isMissingScanCodeSchema(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  const message = error instanceof Error ? error.message : "";
  return (
    code === "42P01" ||
    code === "42703" ||
    /member_scan_codes/.test(message)
  );
}

/** Unique (org_id, code) race — two mentors enroll the same wedge payload at once. */
export function isScanCodeUniqueViolation(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === "23505";
}
