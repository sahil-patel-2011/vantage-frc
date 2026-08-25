import { describe, expect, it } from "vitest";
import {
  doctorExitCode,
  formatDoctorReport,
  onshapeCliKeyChecks,
  onshapeEnvChecks,
  osCapabilityMatrix,
  syncFreshnessCheck,
  SYNC_STALE_WARN_MS,
  type DoctorReport,
} from "../src/doctor";

const NOW = Date.parse("2026-08-24T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();

describe("syncFreshnessCheck", () => {
  it("skips, with the pairing command, when the machine is not paired", () => {
    const check = syncFreshnessCheck({ queued: 0, lastSyncedAt: null }, false, NOW);
    expect(check.status).toBe("skip");
    expect(check.detail).toContain("vantage-cad setup");
  });

  it("passes on a recent sync with an empty queue", () => {
    const check = syncFreshnessCheck({ queued: 0, lastSyncedAt: ago(2 * 3_600_000) }, true, NOW);
    expect(check.status).toBe("pass");
    expect(check.detail).toContain("2h ago");
  });

  it("warns once the last sync is older than the staleness window", () => {
    const check = syncFreshnessCheck({ queued: 0, lastSyncedAt: ago(SYNC_STALE_WARN_MS + 3_600_000) }, true, NOW);
    expect(check.status).toBe("warn");
    expect(check.detail).toContain("vantage-cad");
  });

  it("warns about an undelivered backlog even when the last sync was recent", () => {
    const check = syncFreshnessCheck({ queued: 3, lastSyncedAt: ago(60_000) }, true, NOW);
    expect(check.status).toBe("warn");
    expect(check.detail).toContain("3 events still queued");
  });

  it("does not warn about a machine that has simply never run a CAD tool", () => {
    const check = syncFreshnessCheck({ queued: 0, lastSyncedAt: null }, true, NOW);
    expect(check.status).toBe("skip");
    expect(check.detail).toContain("nothing to sync");
  });

  it("recovers from an unreadable timestamp instead of crashing", () => {
    const check = syncFreshnessCheck({ queued: 0, lastSyncedAt: "not-a-date" }, true, NOW);
    expect(check.status).toBe("warn");
    expect(check.detail).toContain("vantage-cad setup");
  });
});

/** Every non-passing doctor line must name the command that fixes it. */
describe("doctor messages name a fix", () => {
  it("names a fix for half-configured Onshape CLI keys", () => {
    const [check] = onshapeCliKeyChecks({ ONSHAPE_ACCESS_KEY: "only-access" });
    expect(check?.status).toBe("fail");
    expect(check?.detail).toContain("ONSHAPE_SECRET_KEY");
    expect(check?.detail).toContain("dev-portal.onshape.com/keys");
  });

  it("names a fix for half-configured Onshape OAuth env", () => {
    const [check] = onshapeEnvChecks({ ONSHAPE_OAUTH_CLIENT_ID: "id-only" });
    expect(check?.status).toBe("fail");
    expect(check?.detail).toContain("Fix:");
  });

  it("passes when both key halves are present", () => {
    const [check] = onshapeCliKeyChecks({ ONSHAPE_ACCESS_KEY: "a", ONSHAPE_SECRET_KEY: "b" });
    expect(check?.status).toBe("pass");
  });
});

describe("osCapabilityMatrix", () => {
  it("is honest that Linux has no Fusion", () => {
    const linux = osCapabilityMatrix("linux");
    expect(linux.fusionAutodesk).toBe(false);
    expect(linux.onshapeHosted).toBe(true);
  });

  it("allows Fusion on Windows and macOS", () => {
    expect(osCapabilityMatrix("win32").fusionAutodesk).toBe(true);
    expect(osCapabilityMatrix("darwin").fusionAutodesk).toBe(true);
  });
});

describe("doctor report formatting", () => {
  const report = (fail: number): DoctorReport => ({
    ok: fail === 0,
    version: "0.2.0",
    vantageUrl: "https://example.test",
    host: { platform: "win32", release: "10", arch: "x64", node: "22.0.0" },
    osMatrix: osCapabilityMatrix("win32"),
    checks: [
      { id: "node", title: "Node.js runtime", status: "pass", detail: "Node 22" },
      ...(fail ? [{ id: "x", title: "Broken", status: "fail" as const, detail: "Fix: vantage-cad setup" }] : []),
    ],
    summary: { pass: 1, warn: 0, fail, skip: 0 },
  });

  it("prints one bracketed status per check", () => {
    const text = formatDoctorReport(report(0), false);
    expect(text).toContain("[PASS] Node.js runtime");
    expect(text).toContain("Doctor: OK");
  });

  it("exits non-zero when anything failed, for CI", () => {
    expect(doctorExitCode(report(0))).toBe(0);
    expect(doctorExitCode(report(1))).toBe(1);
    expect(formatDoctorReport(report(1), false)).toContain("Doctor: FAILED");
  });

  it("emits parseable JSON under --json", () => {
    const parsed = JSON.parse(formatDoctorReport(report(1), true)) as DoctorReport;
    expect(parsed.ok).toBe(false);
    expect(parsed.summary.fail).toBe(1);
  });
});
