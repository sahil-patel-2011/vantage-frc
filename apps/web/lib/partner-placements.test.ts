import { describe, expect, it } from "vitest";
import { isPartnerSurface, safeHttpUrl, selectedSurfaces, sponsorAssetUrl } from "./partner-placements";

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
});

