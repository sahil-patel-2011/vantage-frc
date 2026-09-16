import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  SCAN_CSS_VARS,
  SCAN_GOLD,
  SCAN_HUB_CLASS,
  SCAN_NAVY,
  scanRailState,
} from "./tokens";

const CSS = readFileSync(join(__dirname, "../../../app/vantage-scan.css"), "utf8");
const MARKETING = readFileSync(join(__dirname, "../../../app/vantage-scan-marketing.css"), "utf8");

describe("vantage scan tokens", () => {
  it("declares every scan CSS variable in the product overlay", () => {
    for (const name of SCAN_CSS_VARS) {
      expect(CSS, name).toContain(`${name}:`);
    }
  });

  it("uses installer-adjacent navy and gold, not a copied window layout", () => {
    expect(CSS).toContain(SCAN_NAVY);
    expect(CSS).toContain(SCAN_GOLD);
    expect(CSS.toLowerCase()).not.toContain("choose tools");
    expect(CSS.toLowerCase()).not.toContain("frc computer setup");
    expect(MARKETING).toContain(SCAN_NAVY);
  });

  it("keeps empty states dashed and left-aligned for ADHD scan", () => {
    expect(CSS).toContain("border-style: dashed");
    expect(CSS).toContain("justify-items: start");
    expect(CSS).toContain("text-align: left");
  });

  it("auth overlay uses gold setup chips and navy primary", () => {
    const auth = readFileSync(join(__dirname, "../../../app/vantage-scan-auth.css"), "utf8");
    expect(auth).toContain("--scan-gold");
    expect(auth).toContain(".signin-setup-shell");
    expect(auth).toContain(".signin-submit");
  });

  it("does not invent demo metrics or leftover kit chrome", () => {
    const blob = `${CSS}\n${MARKETING}`;
    expect(blob).not.toMatch(/\bTBA\b/);
    expect(blob).not.toMatch(/\bEPA\b/);
    expect(blob).not.toMatch(/win-kit|lovat-kit|agent-kit/);
    expect(blob).not.toMatch(/\$0\.00/);
  });

  it("names hub classes consistently", () => {
    expect(SCAN_HUB_CLASS("dashboard")).toBe("scan-hub--dashboard");
    expect(scanRailState(0, 1)).toBe("done");
    expect(scanRailState(1, 1)).toBe("current");
    expect(scanRailState(2, 1)).toBe("upcoming");
  });
});
