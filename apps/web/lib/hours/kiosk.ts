// Kiosk API contract: view shape + request validation. Pure (no server or React
// imports) so both the route and the client compile against one definition and
// the parser is unit-testable.

import { normalizeAutoClosePolicy, type AutoClosePolicy } from "./auto-close";
import { normalizeThreshold, type MemberHoursTotal } from "./eligibility";
import {
  normalizeClientEventId,
  requireScanCode,
  scanCodeKind,
  type ScanCodeKind,
} from "./scan-codes";

export type KioskContext = {
  orgId: string | null;
  orgName: string | null;
  teamNumber: number | null;
  role: string | null;
  userId: string | null;
};

export type KioskPolicy = AutoClosePolicy & {
  /** NULL upstream = this team has not configured a travel-hours threshold. */
  travelEligibilityHours: number | null;
  seasonStart: string | null;
};

export type KioskOpenSession = {
  id: string;
  userId: string;
  userName: string | null;
  kind: string;
  clockIn: string;
};

export type KioskScanCodeRow = {
  id: string;
  userId: string;
  userName: string | null;
  /** Masked tail only — a wall-mounted screen never shows a full student ID. */
  maskedCode: string;
  codeKind: ScanCodeKind;
  label: string;
  createdAt: string;
};

export type KioskView =
  | {
      status: "ready";
      context: KioskContext;
      policy: KioskPolicy;
      openSessions: KioskOpenSession[];
      totals: MemberHoursTotal[];
      /** Owner/admin only; empty for a member-signed-in kiosk. */
      scanCodes: KioskScanCodeRow[];
      /** Members with no card enrolled yet — the mentor's setup checklist. */
      unenrolledCount: number;
    }
  | { status: "setup_required"; context: KioskContext; message: string };

export type KioskScanResult = {
  outcome: "in" | "out";
  memberName: string | null;
  userId: string;
  at: string;
  elapsedHours: number | null;
  backdated: boolean;
  /**
   * True when this exact scan had already been recorded and the server replayed
   * the stored outcome instead of toggling the member a second time.
   */
  duplicate?: boolean;
};

// ---------------------------------------------------------------------------
// Request validation (mirrors parseBuildHoursAction in lib/build-hours.ts).
// ---------------------------------------------------------------------------

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

export const KIOSK_HOUR_KINDS = ["build", "meeting", "outreach", "competition", "other"] as const;
export type KioskHourKind = (typeof KIOSK_HOUR_KINDS)[number];

function hourKind(value: unknown): KioskHourKind {
  if (value == null || value === "") return "build";
  const text = String(value).trim();
  if (!KIOSK_HOUR_KINDS.includes(text as KioskHourKind)) throw new Error("Invalid session kind");
  return text as KioskHourKind;
}

export type KioskAction =
  | {
      action: "scan";
      orgId: string;
      code: string;
      kind: KioskHourKind;
      /** Raw client timestamp for an offline-queued event; validated server-side. */
      occurredAt: string | null;
      /** Idempotency key; null from a client too old to send one. */
      clientEventId: string | null;
    }
  | {
      action: "enroll_code";
      orgId: string;
      userId: string;
      code: string;
      codeKind: ScanCodeKind;
      label: string;
    }
  | { action: "remove_code"; orgId: string; id: string }
  | { action: "auto_close_sweep"; orgId: string }
  | {
      action: "set_kiosk_policy";
      orgId: string;
      policy: AutoClosePolicy;
      travelEligibilityHours: number | null;
    };

export function parseKioskAction(input: unknown): KioskAction {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Invalid kiosk action");
  const body = input as Record<string, unknown>;
  const action = requiredText(body.action, "Action", 40);
  const orgId = uuid(body.orgId, "Organization");

  switch (action) {
    case "scan":
      return {
        action,
        orgId,
        code: requireScanCode(body.code),
        kind: hourKind(body.kind),
        occurredAt: body.occurredAt == null || body.occurredAt === "" ? null : String(body.occurredAt),
        clientEventId: normalizeClientEventId(body.clientEventId),
      };

    case "enroll_code":
      return {
        action,
        orgId,
        userId: uuid(body.userId, "Member"),
        code: requireScanCode(body.code),
        codeKind: scanCodeKind(body.codeKind),
        label: String(body.label ?? "").trim().slice(0, 80),
      };

    case "remove_code":
      return { action, orgId, id: uuid(body.id, "Scan code") };

    case "auto_close_sweep":
      return { action, orgId };

    case "set_kiosk_policy":
      return {
        action,
        orgId,
        policy: normalizeAutoClosePolicy({
          afterHours: body.autoCloseAfterHours == null ? null : Number(body.autoCloseAfterHours),
          creditHours: body.autoCloseCreditHours == null ? null : Number(body.autoCloseCreditHours),
        }),
        travelEligibilityHours: normalizeThreshold(body.travelEligibilityHours),
      };

    default:
      throw new Error("Unsupported kiosk action");
  }
}
