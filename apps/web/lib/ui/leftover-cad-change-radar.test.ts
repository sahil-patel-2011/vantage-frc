import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

/**
 * Leftover student Change radar webhook chrome after leftover-account.
 * leftover-hub-titles extras stay. leftover-export-oauth extras stay.
 * leftover-fmea-boards extras stay. leftover-opening extras stay off these
 * FILES. leftover-cad extras stay off these FILES. leftover-cad-titles extras
 * stay. leftover-cad-map extras stay. leftover-cad-activity extras stay.
 * leftover-cad-onshape extras stay. leftover-opening-cad-setup extras stay.
 * leftover-cad-setup-copy extras stay off these FILES. leftover-llms Connect
 * Onshape stays. leftover-offline extras and leftover-hub extras stay off
 * these FILES — do not gold leftover-hub + leftover-offline pairs together.
 * leftover-help extras stay off leftover-help FILES. leftover-product extras
 * stay off these FILES. leftover-ai-keys extras stay off these FILES.
 * leftover-discord extras stay off these FILES. leftover-slack extras stay
 * off these FILES. leftover-setup extras stay off these FILES. leftover-related
 * extras stay off these FILES. leftover-connections extras stay off these
 * FILES. leftover-alumni extras stay off these FILES. leftover-connectors
 * extras stay off these FILES. leftover-account extras stay off these FILES.
 * leftover-student-buttons extras stay off these FILES. leftover-student-copy
 * extras stay. leftover-invites extras stay. leftover-pick-before Choose your
 * team stays. leftover-opening Opening Change radar stays off these FILES.
 * leftover-api extras stay off leftover-cad-change-radar FILES. leftover-admin
 * skip-list Global Team Manager stays. leftover-my-day Loading My Day stays.
 */
const FILES = ["app/cad-change-radar/cad-change-radar-client.tsx"] as const;

describe("leftover student Change radar chrome", () => {
  it("drops leftover Onshape release webhook and keeps Change radar extras", () => {
    for (const rel of FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/Onshape release webhook/);
      expect(src, rel).not.toMatch(/webhook/i);
      expect(src, rel).not.toMatch(/CAD Change Radar/);
      expect(src, rel).not.toMatch(/CAD Change Impact Radar/);
      expect(src, rel).not.toMatch(/Setup required/);
      expect(src, rel).not.toMatch(/VANTAGE \//);
      expect(src, rel).not.toMatch(/primary-action/);
    }
    const src = readFileSync(join(WEB, "app/cad-change-radar/cad-change-radar-client.tsx"), "utf8");
    expect(src).toMatch(/title="Change radar"/);
    expect(src).toMatch(/feature="Change radar"/);
    expect(src).toMatch(/Onshape document/);
    expect(src).toMatch(/Onshape usually sends new revisions here/);
  });
});
