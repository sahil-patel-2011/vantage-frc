import { describe, expect, it } from "vitest";
import { certExpiryStatus, parseSafetyAction, summarizeSafety, validateCertification, validateIncident } from "./safety";

describe("validateIncident", () => {
  it("requires a title", () => {
    expect(validateIncident({ severity: "minor", occurredOn: "2026-03-01" }).ok).toBe(false);
  });
  it("rejects an unknown severity", () => {
    expect(validateIncident({ title: "Cut finger", severity: "catastrophic", occurredOn: "2026-03-01" }).ok).toBe(false);
  });
  it("rejects a bad date", () => {
    expect(validateIncident({ title: "Cut finger", severity: "minor", occurredOn: "not-a-date" }).ok).toBe(false);
  });
  it("accepts a valid incident and defaults status to open", () => {
    const result = validateIncident({ title: "Cut finger", severity: "minor", occurredOn: "2026-03-01" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.status).toBe("open");
  });
});

describe("validateCertification", () => {
  it("requires a person and valid type", () => {
    expect(validateCertification({ certType: "mill_lathe", completedOn: "2026-01-01" }).ok).toBe(false);
    expect(validateCertification({ personName: "Sam", certType: "nope", completedOn: "2026-01-01" }).ok).toBe(false);
  });
  it("rejects an invalid expiry date", () => {
    expect(validateCertification({ personName: "Sam", certType: "bandsaw", completedOn: "2026-01-01", expiresOn: "xyz" }).ok).toBe(false);
  });
  it("accepts a certification with no expiry", () => {
    const result = validateCertification({ personName: "Sam", certType: "bandsaw", completedOn: "2026-01-01" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.expiresOn).toBeNull();
  });
});

describe("certExpiryStatus", () => {
  const now = new Date("2026-07-17T00:00:00Z");
  it("classifies missing / valid / expiring / expired", () => {
    expect(certExpiryStatus(null, now)).toBe("no_expiry");
    expect(certExpiryStatus("2026-12-01", now)).toBe("valid");
    expect(certExpiryStatus("2026-08-01", now)).toBe("expiring");
    expect(certExpiryStatus("2026-06-01", now)).toBe("expired");
  });
});

describe("summarizeSafety", () => {
  const now = new Date("2026-07-17T00:00:00Z");
  it("counts open + serious incidents, days since last, and cert expiry", () => {
    const summary = summarizeSafety({
      incidents: [
        { severity: "serious", status: "open", occurredOn: "2026-07-10" },
        { severity: "near_miss", status: "closed", occurredOn: "2026-05-01" },
        { severity: "minor", status: "reviewed", occurredOn: "2026-06-01" },
      ],
      certifications: [{ expiresOn: "2026-08-01" }, { expiresOn: "2026-06-01" }, { expiresOn: null }],
      now,
    });
    expect(summary.openIncidents).toBe(2);
    expect(summary.seriousOpen).toBe(1);
    expect(summary.daysSinceLastIncident).toBe(7);
    expect(summary.expiringCerts).toBe(1);
    expect(summary.expiredCerts).toBe(1);
  });
  it("reports null days-since when there are no incidents", () => {
    expect(summarizeSafety({ incidents: [], certifications: [], now }).daysSinceLastIncident).toBeNull();
  });
});

describe("parseSafetyAction", () => {
  it("parses a log_incident action", () => {
    const action = parseSafetyAction({ action: "log_incident", orgId: "o1", title: "Pinch", severity: "minor", occurredOn: "2026-03-01" });
    expect(action).toMatchObject({ action: "log_incident", severity: "minor", treatment: "none" });
  });
  it("rejects an invalid treatment", () => {
    expect(() => parseSafetyAction({ action: "log_incident", orgId: "o1", title: "Pinch", severity: "minor", occurredOn: "2026-03-01", treatment: "surgery" })).toThrow();
  });
  it("rejects an unsupported action", () => {
    expect(() => parseSafetyAction({ action: "nuke", orgId: "o1" })).toThrow(/Unsupported/);
  });
});
