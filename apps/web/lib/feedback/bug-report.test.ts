import { describe, expect, it } from "vitest";
import {
  BUG_DESCRIPTION_MAX,
  BUG_USER_AGENT_MAX,
  bugAppAreaFromRoute,
  normalizeBugReport,
  normalizeBugRoute,
  sanitizeBugClientInfo,
} from "./bug-report";

describe("normalizeBugRoute", () => {
  it("keeps same-origin paths with query, drops the hash", () => {
    expect(normalizeBugRoute("/competition?tab=scouting#section")).toBe("/competition?tab=scouting");
  });

  it("rejects absolute and protocol-relative URLs", () => {
    expect(normalizeBugRoute("https://evil.example/steal")).toBeNull();
    expect(normalizeBugRoute("//evil.example/steal")).toBeNull();
  });

  it("returns null for blank input", () => {
    expect(normalizeBugRoute("")).toBeNull();
    expect(normalizeBugRoute(undefined)).toBeNull();
    expect(normalizeBugRoute("   ")).toBeNull();
  });

  it("clamps very long routes", () => {
    const route = normalizeBugRoute(`/page?q=${"x".repeat(1000)}`);
    expect(route).not.toBeNull();
    expect(route!.length).toBeLessThanOrEqual(300);
  });
});

describe("bugAppAreaFromRoute", () => {
  it("uses the first path segment", () => {
    expect(bugAppAreaFromRoute("/team?tab=calendar")).toBe("team");
    expect(bugAppAreaFromRoute("/build")).toBe("build");
  });

  it("returns null when there is no route", () => {
    expect(bugAppAreaFromRoute(null)).toBeNull();
    expect(bugAppAreaFromRoute("/")).toBeNull();
  });
});

describe("sanitizeBugClientInfo", () => {
  it("keeps only viewport and user agent", () => {
    const info = sanitizeBugClientInfo({
      viewportWidth: 1280.6,
      viewportHeight: 800,
      userAgent: " Mozilla/5.0 ",
      canvasFingerprint: "nope",
      plugins: ["nope"],
    });
    expect(info).toEqual({ viewportWidth: 1281, viewportHeight: 800, userAgent: "Mozilla/5.0" });
  });

  it("drops non-finite and non-positive dimensions", () => {
    expect(sanitizeBugClientInfo({ viewportWidth: -3, viewportHeight: NaN })).toEqual({});
    expect(sanitizeBugClientInfo(null)).toEqual({});
    expect(sanitizeBugClientInfo("string")).toEqual({});
  });

  it("truncates absurd user agents", () => {
    const info = sanitizeBugClientInfo({ userAgent: "a".repeat(2000) });
    expect(info.userAgent!.length).toBe(BUG_USER_AGENT_MAX);
  });
});

describe("normalizeBugReport", () => {
  it("accepts a bare description", () => {
    const result = normalizeBugReport({ description: "The save button does nothing." });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.report.severity).toBeNull();
      expect(result.report.route).toBeNull();
      expect(result.report.appArea).toBeNull();
    }
  });

  it("rejects an empty description", () => {
    expect(normalizeBugReport({ description: "   " }).ok).toBe(false);
    expect(normalizeBugReport({}).ok).toBe(false);
  });

  it("rejects an oversized description", () => {
    expect(normalizeBugReport({ description: "x".repeat(BUG_DESCRIPTION_MAX + 1) }).ok).toBe(false);
  });

  it("rejects an unknown severity but allows omitting it", () => {
    expect(normalizeBugReport({ description: "d", severity: "catastrophic" }).ok).toBe(false);
    const ok = normalizeBugReport({ description: "d", severity: "blocking" });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.report.severity).toBe("blocking");
  });

  it("derives app area from the captured route", () => {
    const result = normalizeBugReport({ description: "d", route: "/competition?tab=scouting" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.report.appArea).toBe("competition");
  });
});
