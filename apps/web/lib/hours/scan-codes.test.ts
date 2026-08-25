import { describe, expect, it } from "vitest";
import {
  MAX_CLIENT_EVENT_ID_LENGTH,
  MAX_OFFLINE_BACKDATE_MS,
  MAX_SCAN_CODE_LENGTH,
  maskScanCode,
  newClientEventId,
  normalizeClientEventId,
  normalizeScanCode,
  requireScanCode,
  resolveOccurredAt,
  scanCodeKind,
  scanCodeProblem,
  scanFeedbackMessage,
} from "./scan-codes";

describe("normalizeScanCode", () => {
  it("strips the CR/LF a keyboard-wedge scanner appends", () => {
    expect(normalizeScanCode("A12345\r\n")).toBe("A12345");
  });

  it("strips a leading tab or space prefix some readers emit", () => {
    expect(normalizeScanCode("\tA12345")).toBe("A12345");
    expect(normalizeScanCode("  A12345  ")).toBe("A12345");
  });

  it("upper-cases so a typed fallback matches the enrolled card", () => {
    expect(normalizeScanCode("a12345")).toBe(normalizeScanCode("A12345"));
  });

  it("preserves leading zeros — 0042 and 42 are different student IDs", () => {
    expect(normalizeScanCode("0042")).toBe("0042");
    expect(normalizeScanCode("0042")).not.toBe(normalizeScanCode("42"));
  });

  it("drops interior whitespace and control characters", () => {
    expect(normalizeScanCode("A1 2345")).toBe("A12345");
  });

  it("handles null and undefined without throwing", () => {
    expect(normalizeScanCode(null)).toBe("");
    expect(normalizeScanCode(undefined)).toBe("");
  });

  it("is idempotent — enrollment and scan normalize identically", () => {
    const once = normalizeScanCode(" a12-345\r\n");
    expect(normalizeScanCode(once)).toBe(once);
  });
});

describe("scanCodeProblem", () => {
  it("refuses an email address as a scan identifier", () => {
    expect(scanCodeProblem(normalizeScanCode("maya@team.org"))).toBe("email");
  });

  it("flags empty, too short, and too long", () => {
    expect(scanCodeProblem("")).toBe("empty");
    expect(scanCodeProblem("AB")).toBe("too_short");
    expect(scanCodeProblem("A".repeat(MAX_SCAN_CODE_LENGTH + 1))).toBe("too_long");
  });

  it("accepts a realistic student ID and RFID payload", () => {
    expect(scanCodeProblem(normalizeScanCode("0041289"))).toBeNull();
    expect(scanCodeProblem(normalizeScanCode("3B00A1F2C9"))).toBeNull();
  });
});

describe("requireScanCode", () => {
  it("returns the normalized code for a valid scan", () => {
    expect(requireScanCode(" a12345\r\n")).toBe("A12345");
  });

  it("throws a kiosk-readable message rather than a raw error", () => {
    expect(() => requireScanCode("maya@team.org")).toThrow(/not an email/i);
    expect(() => requireScanCode("")).toThrow(/scan or type/i);
  });
});

describe("maskScanCode", () => {
  it("shows only the last four characters on a wall-mounted screen", () => {
    expect(maskScanCode("0041289")).toBe("••••1289");
  });

  it("fully masks a short code rather than leaking all of it", () => {
    expect(maskScanCode("1234")).toBe("••••");
    expect(maskScanCode("1234")).not.toContain("1");
  });

  it("returns empty for an empty code", () => {
    expect(maskScanCode("")).toBe("");
  });
});

describe("scanCodeKind", () => {
  it("defaults to student_id and rejects an unknown kind", () => {
    expect(scanCodeKind(null)).toBe("student_id");
    expect(scanCodeKind("barcode")).toBe("barcode");
    expect(() => scanCodeKind("fingerprint")).toThrow(/invalid/i);
  });
});

describe("resolveOccurredAt", () => {
  const now = Date.UTC(2026, 1, 14, 18, 0, 0);

  it("uses server time when the client sent none", () => {
    expect(resolveOccurredAt(null, now)).toEqual({ kind: "now", iso: null });
    expect(resolveOccurredAt("", now)).toEqual({ kind: "now", iso: null });
  });

  it("backdates a queued scan to when it actually happened", () => {
    const scanned = new Date(now - 2 * 3_600_000).toISOString();
    const result = resolveOccurredAt(scanned, now);
    expect(result.kind).toBe("backdated");
    expect(result.iso).toBe(scanned);
  });

  it("tolerates small kiosk-tablet clock skew", () => {
    expect(resolveOccurredAt(new Date(now + 30_000).toISOString(), now).kind).toBe("backdated");
  });

  it("refuses a future timestamp rather than clamping it", () => {
    const result = resolveOccurredAt(new Date(now + 600_000).toISOString(), now);
    expect(result.kind).toBe("rejected");
    expect(result.iso).toBeNull();
  });

  it("refuses a stale queue instead of backdating month-old attendance", () => {
    const stale = new Date(now - MAX_OFFLINE_BACKDATE_MS - 60_000).toISOString();
    expect(resolveOccurredAt(stale, now).kind).toBe("rejected");
  });

  it("accepts a weekend of dead Wi-Fi", () => {
    const weekend = new Date(now - 2 * 24 * 3_600_000).toISOString();
    expect(resolveOccurredAt(weekend, now).kind).toBe("backdated");
  });

  it("rejects an unparseable timestamp", () => {
    expect(resolveOccurredAt("not-a-date", now).kind).toBe("rejected");
  });
});

describe("scanFeedbackMessage", () => {
  const at = new Date(Date.UTC(2026, 1, 14, 18, 2, 0)).toISOString();

  it("greets by name on clock-in", () => {
    const text = scanFeedbackMessage({ outcome: "in", memberName: "Maya", at });
    expect(text).toContain("Welcome, Maya");
    expect(text).toContain("clocked IN");
  });

  it("reports elapsed hours on clock-out", () => {
    const text = scanFeedbackMessage({
      outcome: "out",
      memberName: "Maya",
      at,
      elapsedHours: 2.5,
    });
    expect(text).toContain("See you, Maya");
    expect(text).toContain("2.5h");
  });

  it("falls back to a neutral noun when the name is missing", () => {
    expect(scanFeedbackMessage({ outcome: "in", memberName: null, at })).toContain("Member");
    expect(scanFeedbackMessage({ outcome: "in", memberName: "   ", at })).toContain("Member");
  });

  it("says so when the scan was only queued, never implying it was recorded", () => {
    const text = scanFeedbackMessage({ outcome: "in", memberName: "Maya", at, queuedOffline: true });
    expect(text).toContain("queued offline");
  });

  it("omits an elapsed figure it does not have rather than printing 0h", () => {
    const text = scanFeedbackMessage({ outcome: "out", memberName: "Maya", at, elapsedHours: null });
    expect(text).not.toMatch(/\d+(\.\d+)?h/);
  });
});

// The scan idempotency key. A scan TOGGLES a member in or out, and the offline
// path re-sends any scan whose response was lost — including ones the server
// already committed. Without a stable key the replay clocks a student straight
// back out, fabricating a session. These guard that key's contract.
describe("newClientEventId", () => {
  it("issues a distinct id per scan so two students never share one", () => {
    const ids = new Set(Array.from({ length: 200 }, () => newClientEventId()));
    expect(ids.size).toBe(200);
  });

  it("produces an id the server-side validator accepts", () => {
    for (let i = 0; i < 50; i++) {
      const id = newClientEventId();
      expect(() => normalizeClientEventId(id)).not.toThrow();
      expect(normalizeClientEventId(id)).toBe(id);
    }
  });

  it("still issues usable ids when crypto.randomUUID is missing", () => {
    // Cheap kiosk tablets are exactly where idempotency matters most, so the
    // fallback must not silently disable it.
    const original = globalThis.crypto;
    try {
      Object.defineProperty(globalThis, "crypto", { value: {}, configurable: true });
      const id = newClientEventId();
      expect(normalizeClientEventId(id)).toBe(id);
    } finally {
      Object.defineProperty(globalThis, "crypto", { value: original, configurable: true });
    }
  });
});

describe("normalizeClientEventId", () => {
  it("treats an absent key as absent rather than inventing one", () => {
    // An older client that sends no key must still be able to scan; it simply
    // forfeits replay protection instead of being rejected.
    expect(normalizeClientEventId(null)).toBeNull();
    expect(normalizeClientEventId(undefined)).toBeNull();
    expect(normalizeClientEventId("")).toBeNull();
    expect(normalizeClientEventId("   ")).toBeNull();
  });

  it("preserves the exact token so a retry matches the original row", () => {
    expect(normalizeClientEventId("  abcdefgh  ")).toBe("abcdefgh");
  });

  it("rejects lengths the migration CHECK would refuse, as a readable error", () => {
    expect(() => normalizeClientEventId("short")).toThrow(/invalid/i);
    expect(() => normalizeClientEventId("x".repeat(MAX_CLIENT_EVENT_ID_LENGTH + 1))).toThrow(/invalid/i);
    expect(normalizeClientEventId("x".repeat(MAX_CLIENT_EVENT_ID_LENGTH))).toHaveLength(
      MAX_CLIENT_EVENT_ID_LENGTH,
    );
  });
});
