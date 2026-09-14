import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

/**
 * Leftover student connector-status webhook chrome after leftover-alumni.
 * leftover-invites extras stay (FILES include this file; ban Team admin
 * only). leftover-opening extras stay off these FILES. leftover-opening-funding
 * Opening Connectors stays. leftover-pick-before Choose your team stays.
 * leftover-offline extras and leftover-hub extras stay off these FILES —
 * do not gold leftover-hub + leftover-offline pairs together. leftover-help
 * extras stay off leftover-help FILES. leftover-cad extras stay off these
 * FILES. leftover-cad-setup-copy extras stay off these FILES. leftover-product
 * extras stay off these FILES. leftover-ai-keys extras stay off these FILES.
 * leftover-discord extras stay off these FILES. leftover-slack extras stay
 * off these FILES. leftover-setup extras stay off these FILES. leftover-related
 * extras stay off these FILES. leftover-connections extras stay off these
 * FILES. leftover-alumni extras stay off these FILES. leftover-student-buttons
 * extras stay off these FILES. leftover-admin skip-list Global Team Manager
 * stays. leftover-my-day Loading My Day stays. leftover-team-data extras
 * stay. Internal webhookUrl stays.
 */
const FILES = ["lib/connectors/load-connector-status.ts"] as const;

describe("leftover student connector-status chrome", () => {
  it("drops leftover webhook dumps and keeps Discord / Slack channel link extras", () => {
    for (const rel of FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/channel webhook/i);
      expect(src, rel).not.toMatch(/incoming webhook/i);
      expect(src, rel).not.toMatch(/Slack webhook/);
      expect(src, rel).not.toMatch(/Setup required/);
      expect(src, rel).not.toMatch(/VANTAGE \//);
      expect(src, rel).not.toMatch(/primary-action/);
      expect(src, rel).not.toMatch(/Team admin/);
    }
    const src = readFileSync(join(WEB, "lib/connectors/load-connector-status.ts"), "utf8");
    expect(src).toMatch(/Discord channel link/);
    expect(src).toMatch(/Slack channel link/);
    expect(src).toMatch(/Choose your team/);
    expect(src).toMatch(/webhookUrl/);
    expect(src).toMatch(/TBA Read API/);
  });
});
