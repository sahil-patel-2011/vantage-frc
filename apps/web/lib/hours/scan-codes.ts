// Scan-in kiosk domain logic — framework-free, shared by the kiosk API route,
// the kiosk client, and unit tests. No server, React, or DOM imports belong here.
//
// USB barcode / RFID / student-ID readers are keyboard-wedge devices: they type
// the code into whatever field has focus and press Enter. That means the raw
// input arrives with scanner noise — a trailing CR/LF, an occasional leading
// tab or prefix space, sometimes an inverted-case read. Everything here
// normalizes the same way on enrollment and on scan so the two always match.

export const SCAN_CODE_KINDS = ["student_id", "barcode", "manual"] as const;
export type ScanCodeKind = (typeof SCAN_CODE_KINDS)[number];

export const SCAN_CODE_KIND_LABELS: Record<ScanCodeKind, string> = {
  student_id: "Student ID",
  barcode: "Barcode / RFID",
  manual: "Typed code",
};

export const MIN_SCAN_CODE_LENGTH = 3;
export const MAX_SCAN_CODE_LENGTH = 64;

/**
 * Canonical form of a scanned or typed identifier.
 *
 * Strips every whitespace and control character (scanners append CR/LF and some
 * models prefix a tab), then upper-cases so a lower-case manual entry still
 * matches an enrolled card. Leading zeros are preserved — "0042" and "42" are
 * different student IDs on plenty of school rosters.
 */
export function normalizeScanCode(raw: unknown): string {
  const text = String(raw ?? "");
  let out = "";
  for (const char of text) {
    const point = char.codePointAt(0) ?? 0;
    // Drop C0/C1 controls, DEL, and every whitespace class.
    if (point < 0x20 || point === 0x7f || (point >= 0x80 && point <= 0x9f)) continue;
    if (/\s/u.test(char)) continue;
    out += char;
  }
  return out.toUpperCase();
}

/** True when the code looks like an email — never allowed as a scan identifier. */
export function looksLikeEmail(code: string): boolean {
  return /@/.test(code);
}

export type ScanCodeProblem =
  | "empty"
  | "too_short"
  | "too_long"
  | "email";

const PROBLEM_MESSAGES: Record<ScanCodeProblem, string> = {
  empty: "Scan or type an ID first.",
  too_short: `A scan code needs at least ${MIN_SCAN_CODE_LENGTH} characters.`,
  too_long: `A scan code can be at most ${MAX_SCAN_CODE_LENGTH} characters.`,
  email: "Use a card or student ID, not an email address.",
};

/** Why a normalized code is unusable, or null when it is fine. */
export function scanCodeProblem(code: string): ScanCodeProblem | null {
  if (!code) return "empty";
  if (looksLikeEmail(code)) return "email";
  if (code.length < MIN_SCAN_CODE_LENGTH) return "too_short";
  if (code.length > MAX_SCAN_CODE_LENGTH) return "too_long";
  return null;
}

export function scanCodeProblemMessage(problem: ScanCodeProblem): string {
  return PROBLEM_MESSAGES[problem];
}

/** Normalize + validate in one step. Throws with a kiosk-readable message. */
export function requireScanCode(raw: unknown): string {
  const code = normalizeScanCode(raw);
  const problem = scanCodeProblem(code);
  if (problem) throw new Error(scanCodeProblemMessage(problem));
  return code;
}

/**
 * Kiosk-safe display form. A student ID on a wall-mounted screen is minors'
 * data in a room full of strangers, so only the tail is ever rendered.
 */
export function maskScanCode(code: string): string {
  const normalized = normalizeScanCode(code);
  if (!normalized) return "";
  if (normalized.length <= 4) return "•".repeat(normalized.length);
  return `••••${normalized.slice(-4)}`;
}

export function scanCodeKind(value: unknown): ScanCodeKind {
  if (value == null || value === "") return "student_id";
  const text = String(value).trim();
  if (!SCAN_CODE_KINDS.includes(text as ScanCodeKind)) throw new Error("Invalid scan code kind");
  return text as ScanCodeKind;
}

/**
 * How long an offline-queued clock event may lag before we refuse to backdate
 * it. A weekend of dead shop Wi-Fi is fine; a month-old queue is not evidence.
 */
export const MAX_OFFLINE_BACKDATE_MS = 7 * 24 * 60 * 60 * 1000;

export const MIN_CLIENT_EVENT_ID_LENGTH = 8;
export const MAX_CLIENT_EVENT_ID_LENGTH = 64;

/**
 * Idempotency key for a scan.
 *
 * A scan TOGGLES a member in or out, so replaying one is destructive rather
 * than harmless — it clocks a student straight back out. The offline path makes
 * a lost response ordinary: the client queues any scan whose fetch never
 * returned, which is precisely what a shop Wi-Fi drop does AFTER the server has
 * already committed. The same id must therefore travel with the immediate POST
 * and with the queued copy of that same scan, so the server can recognise the
 * replay and return the original outcome instead of toggling twice.
 */
export function newClientEventId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Kiosks run on cheap, sometimes elderly tablets; a missing crypto.randomUUID
  // must not disable idempotency, because that is when it matters most.
  return `k-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * Accept a client-supplied idempotency key, or null when absent.
 *
 * Deliberately permissive about FORM (any opaque token is fine) and strict about
 * LENGTH, matching the migration's CHECK so a bad key surfaces as a readable
 * 400 rather than a constraint violation.
 */
export function normalizeClientEventId(raw: unknown): string | null {
  if (raw == null || raw === "") return null;
  const text = String(raw).trim();
  if (!text) return null;
  if (text.length < MIN_CLIENT_EVENT_ID_LENGTH || text.length > MAX_CLIENT_EVENT_ID_LENGTH) {
    throw new Error("Scan id is invalid");
  }
  return text;
}

export type BackdateResult =
  | { kind: "now"; iso: null }
  | { kind: "backdated"; iso: string }
  | { kind: "rejected"; iso: null; reason: string };

/**
 * Decide the timestamp a queued scan should be written with.
 *
 * Attendance queued at 6:02pm on a dead network must be recorded as 6:02pm, not
 * as whenever the Wi-Fi came back — otherwise the log is fiction. Future
 * timestamps and stale ones are refused rather than quietly clamped.
 */
export function resolveOccurredAt(raw: unknown, now: number): BackdateResult {
  if (raw == null || raw === "") return { kind: "now", iso: null };
  const parsed = new Date(String(raw)).getTime();
  if (!Number.isFinite(parsed)) {
    return { kind: "rejected", iso: null, reason: "Queued timestamp is invalid" };
  }
  // Small clock skew between a kiosk tablet and the server is normal.
  if (parsed > now + 60_000) {
    return { kind: "rejected", iso: null, reason: "Queued timestamp is in the future" };
  }
  if (now - parsed > MAX_OFFLINE_BACKDATE_MS) {
    return { kind: "rejected", iso: null, reason: "Queued timestamp is more than 7 days old" };
  }
  return { kind: "backdated", iso: new Date(parsed).toISOString() };
}

// ---------------------------------------------------------------------------
// Kiosk feedback copy (pure so the wording is testable).
// ---------------------------------------------------------------------------

export type ScanOutcome = "in" | "out";

function clockLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "just now";
  return date
    .toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    .toLowerCase()
    .replace(/\s+/g, "");
}

/** "Welcome, Maya — clocked IN at 6:02pm" / "See you, Maya — OUT at 8:30pm · 2.5h" */
export function scanFeedbackMessage(input: {
  outcome: ScanOutcome;
  memberName: string | null;
  at: string;
  elapsedHours?: number | null;
  queuedOffline?: boolean;
}): string {
  const name = input.memberName?.trim() || "Member";
  const time = clockLabel(input.at);
  const offline = input.queuedOffline ? " (queued offline)" : "";
  if (input.outcome === "in") {
    return `Welcome, ${name} — clocked IN at ${time}${offline}`;
  }
  const elapsed =
    typeof input.elapsedHours === "number" && Number.isFinite(input.elapsedHours) && input.elapsedHours > 0
      ? ` · ${Math.round(input.elapsedHours * 100) / 100}h`
      : "";
  return `See you, ${name} — clocked OUT at ${time}${elapsed}${offline}`;
}

/** How long a kiosk banner stays on screen before the field is clear for the next student. */
export const SCAN_FEEDBACK_MS = 4000;
