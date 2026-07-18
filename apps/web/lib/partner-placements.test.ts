import { describe, expect, it } from "vitest";
import {
  isPartnerSurface,
  orgScopedPackageId,
  safeHttpUrl,
  selectedSurfaces,
  sponsorAssetUrl,
} from "./partner-placements";

describe("partner placement boundaries", () => {
  it("accepts only known placement surfaces", () => {
    expect(isPartnerSurface("business_wall")).toBe(true);
    expect(isPartnerSurface("signin_takeover")).toBe(false);
    expect(selectedSurfaces(["pit_footer", "bad", "dashboard_footer"])).toEqual(["dashboard_footer", "pit_footer"]);
  });

  it("allows web links and rejects active-content protocols", () => {
    expect(safeHttpUrl("https://example.com/sponsor")).toBe("https://example.com/sponsor");
    expect(safeHttpUrl("javascript:alert(1)")).toBeNull();
    expect(safeHttpUrl("data:text/html,hello")).toBeNull();
  });

  it("builds same-origin asset URLs", () => {
    expect(sponsorAssetUrl("a/b")).toBe("/api/partner-assets/a%2Fb");
  });

  it("scopes packageId to the org and rejects foreign packages", () => {
    expect(orgScopedPackageId("", ["pkg-a"])).toBeNull();
    expect(orgScopedPackageId("pkg-a", ["pkg-a", "pkg-b"])).toBe("pkg-a");
    expect(() => orgScopedPackageId("pkg-other-org", ["pkg-a"])).toThrow(/Placement package not found/);
  });
});

