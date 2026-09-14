import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

/**
 * Leftover student CAD activity chrome after leftover-agent-config.
 * leftover-cad extras stay. leftover-cad-titles extras stay.
 * leftover-cad-map extras stay. leftover-cad-onshape extras stay.
 * leftover-opening-cad-setup extras stay. leftover-cad-setup-copy extras
 * stay. leftover-llms Connect Onshape stays. leftover-student-copy extras
 * stay. leftover-student-buttons extras stay. leftover-product extras stay.
 * leftover-help extras stay off leftover-help FILES. leftover-cad-change-radar
 * extras stay off leftover-cad-activity FILES. leftover-admin
 * skip-list Global Team Manager stays. leftover-my-day Loading My Day stays.
 */
const FILES = ["app/cad/cad-activity-panel.tsx"] as const;

describe("leftover student CAD activity chrome", () => {
  it("does not dump vantage-cad or leftover Web agent chrome", () => {
    for (const rel of FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/vantage-cad/);
      expect(src, rel).not.toMatch(/Web agent/);
      expect(src, rel).not.toMatch(/Setup required/);
      expect(src, rel).not.toMatch(/VANTAGE \//);
      expect(src, rel).not.toMatch(/primary-action/);
    }
    const src = readFileSync(join(WEB, "app/cad/cad-activity-panel.tsx"), "utf8");
    expect(src).toMatch(/This computer/);
    expect(src).toMatch(/This page/);
    expect(src).toMatch(/Claude Code/);
  });
});
