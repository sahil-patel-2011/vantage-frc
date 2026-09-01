import { describe, expect, it } from "vitest";
import { joinCodeLimits, joinCodeState, type JoinCodeLimits } from "./join-codes";

const NOW = Date.parse("2026-03-01T12:00:00Z");

function code(overrides: Partial<JoinCodeLimits> = {}): JoinCodeLimits {
  return { uses: 0, maxUses: null, expiresAt: null, revokedAt: null, ...overrides };
}

describe("joinCodeState", () => {
  it("treats an open-ended code with no expiry as live", () => {
    expect(joinCodeState(code(), NOW)).toEqual({ label: "Live", tone: "live" });
  });

  it("reports a revoked code as off even when it has uses and time left", () => {
    const state = joinCodeState(
      code({ revokedAt: "2026-02-01T00:00:00Z", maxUses: 10, expiresAt: "2026-12-01T00:00:00Z" }),
      NOW,
    );
    expect(state).toEqual({ label: "Off", tone: "off" });
  });

  it("expires exactly at the boundary, matching the redeem function's ends_at > now()", () => {
    const at = "2026-03-01T12:00:00Z";
    expect(joinCodeState(code({ expiresAt: at }), NOW).label).toBe("Expired");
    expect(joinCodeState(code({ expiresAt: at }), NOW - 1).label).toBe("Live");
  });

  it("is used up once uses reach maxUses, not only past it", () => {
    expect(joinCodeState(code({ uses: 4, maxUses: 5 }), NOW).label).toBe("Live");
    expect(joinCodeState(code({ uses: 5, maxUses: 5 }), NOW).label).toBe("Used up");
    expect(joinCodeState(code({ uses: 6, maxUses: 5 }), NOW).label).toBe("Used up");
  });

  it("never calls a code used up when maxUses is unlimited", () => {
    expect(joinCodeState(code({ uses: 500, maxUses: null }), NOW).label).toBe("Live");
  });

  it("prefers the reason the owner can act on when several apply", () => {
    const dead = code({
      revokedAt: "2026-01-01T00:00:00Z",
      expiresAt: "2026-01-01T00:00:00Z",
      uses: 9,
      maxUses: 9,
    });
    expect(joinCodeState(dead, NOW).label).toBe("Off");

    const stale = code({ expiresAt: "2026-01-01T00:00:00Z", uses: 9, maxUses: 9 });
    expect(joinCodeState(stale, NOW).label).toBe("Expired");
  });
});

describe("joinCodeLimits", () => {
  it("counts joins rather than inventing a ceiling for unlimited codes", () => {
    expect(joinCodeLimits(code({ uses: 3 }), NOW)).toBe("3 joined");
  });

  it("shows progress against a real cap", () => {
    expect(joinCodeLimits(code({ uses: 3, maxUses: 10 }), NOW)).toBe("3 of 10 used");
  });

  it("says expires for a future date and expired for a past one", () => {
    expect(joinCodeLimits(code({ expiresAt: "2026-12-01T00:00:00Z" }), NOW)).toMatch(
      /^0 joined · expires \S+$/,
    );
    expect(joinCodeLimits(code({ expiresAt: "2026-01-01T00:00:00Z" }), NOW)).toMatch(
      /^0 joined · expired \S+$/,
    );
  });

  it("omits the expiry clause entirely when there is none", () => {
    expect(joinCodeLimits(code({ uses: 1, maxUses: 2 }), NOW)).not.toMatch(/expir/);
  });

  it("agrees with joinCodeState at the expiry boundary", () => {
    const at = "2026-03-01T12:00:00Z";
    expect(joinCodeState(code({ expiresAt: at }), NOW).label).toBe("Expired");
    expect(joinCodeLimits(code({ expiresAt: at }), NOW)).toMatch(/expired/);
  });
});
