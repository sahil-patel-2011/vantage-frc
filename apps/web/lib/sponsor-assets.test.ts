import { describe, expect, it } from "vitest";
import { internalSponsorAssetUrl, safeSponsorFilename, sponsorImageKind } from "./sponsor-assets";

describe("sponsor artwork safeguards", () => {
  it("recognizes only supported image signatures", () => {
    expect(sponsorImageKind(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe("png");
    expect(sponsorImageKind(Uint8Array.from([0xff, 0xd8, 0xff]))).toBe("jpeg");
    expect(sponsorImageKind(Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]))).toBe("webp");
    expect(sponsorImageKind(Uint8Array.from([0x3c, 0x73, 0x76, 0x67]))).toBeNull();
  });

  it("keeps public image delivery on our own origin", () => {
    expect(internalSponsorAssetUrl("abc/def")).toBe("/api/partner-assets/abc%2Fdef");
    expect(safeSponsorFilename("../../ Acme Logo!!.png")).toBe("Acme-Logo.png");
  });
});
