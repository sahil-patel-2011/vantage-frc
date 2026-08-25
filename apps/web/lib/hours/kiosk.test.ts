import { describe, expect, it } from "vitest";
import { parseKioskAction } from "./kiosk";

const ORG = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";

const scan = (extra: Record<string, unknown> = {}) =>
  parseKioskAction({ action: "scan", orgId: ORG, code: "A12345", ...extra });

describe("parseKioskAction — scan", () => {
  it("normalizes the keyboard-wedge payload the scanner actually types", () => {
    // Wedge readers append CR/LF and sometimes a tab prefix; enrollment and scan
    // must normalize identically or a valid card never matches.
    expect(scan({ code: "\ta12345\r\n" }).code).toBe("A12345");
  });

  it("defaults the session kind rather than failing a scan on a missing field", () => {
    expect(scan().kind).toBe("build");
  });

  it("rejects a kind outside the hour_logs CHECK", () => {
    expect(() => scan({ kind: "nap" })).toThrow(/Invalid session kind/i);
  });

  it("refuses an email as a scan identifier", () => {
    // The whole point of member_scan_codes is an identifier that is NOT an email.
    expect(() => scan({ code: "maya@example.com" })).toThrow(/card or student ID/i);
  });

  it("requires a real org id", () => {
    expect(() => parseKioskAction({ action: "scan", orgId: "nope", code: "A12345" })).toThrow(
      /Organization is invalid/i,
    );
  });

  // --- idempotency key -----------------------------------------------------
  // A scan is a toggle, so a replayed scan is destructive. The key is what lets
  // the server tell "the student scanned again" from "the response was lost".

  it("carries the idempotency key through untouched", () => {
    const id = "3f7d2c19-0a5b-4c8e-9d11-6b2f8e4a1c07";
    expect(scan({ clientEventId: id }).clientEventId).toBe(id);
  });

  it("accepts a scan with no key so an older client keeps working", () => {
    expect(scan().clientEventId).toBeNull();
    expect(scan({ clientEventId: "" }).clientEventId).toBeNull();
  });

  it("rejects a malformed key instead of letting the DB CHECK raise a 500", () => {
    expect(() => scan({ clientEventId: "abc" })).toThrow(/Scan id is invalid/i);
  });

  it("keeps occurredAt so an offline scan records when it happened, not when it synced", () => {
    const at = "2026-02-14T18:02:00.000Z";
    expect(scan({ occurredAt: at }).occurredAt).toBe(at);
    expect(scan().occurredAt).toBeNull();
  });
});

describe("parseKioskAction — policy", () => {
  it("keeps an unset travel threshold null rather than inventing a number", () => {
    // The honesty rule: no threshold configured must stay "not configured".
    const action = parseKioskAction({ action: "set_kiosk_policy", orgId: ORG });
    if (action.action !== "set_kiosk_policy") throw new Error("wrong action");
    expect(action.travelEligibilityHours).toBeNull();
  });

  it("treats a zero or negative threshold as unset, not as 'everyone qualifies'", () => {
    for (const value of [0, -5]) {
      const action = parseKioskAction({
        action: "set_kiosk_policy",
        orgId: ORG,
        travelEligibilityHours: value,
      });
      if (action.action !== "set_kiosk_policy") throw new Error("wrong action");
      expect(action.travelEligibilityHours).toBeNull();
    }
  });

  it("clamps a sweep policy into the range the migration allows", () => {
    const action = parseKioskAction({
      action: "set_kiosk_policy",
      orgId: ORG,
      autoCloseAfterHours: 10_000,
      autoCloseCreditHours: 999,
    });
    if (action.action !== "set_kiosk_policy") throw new Error("wrong action");
    expect(action.policy.afterHours).toBeLessThanOrEqual(168);
    expect(action.policy.creditHours).toBeLessThanOrEqual(24);
  });
});

describe("parseKioskAction — enrollment", () => {
  it("parses an enrollment and trims an over-long label to the column width", () => {
    const action = parseKioskAction({
      action: "enroll_code",
      orgId: ORG,
      userId: USER,
      code: "b998877",
      codeKind: "barcode",
      label: "x".repeat(200),
    });
    if (action.action !== "enroll_code") throw new Error("wrong action");
    expect(action.code).toBe("B998877");
    expect(action.codeKind).toBe("barcode");
    expect(action.label).toHaveLength(80);
  });

  it("rejects an unknown action rather than guessing intent", () => {
    expect(() => parseKioskAction({ action: "drop_table", orgId: ORG })).toThrow(/Unsupported/i);
  });
});
