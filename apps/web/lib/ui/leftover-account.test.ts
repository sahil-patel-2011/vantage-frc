import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

/**
 * Leftover student Account Slack webhook chrome after leftover-connectors.
 * leftover-opening extras stay off these FILES. leftover-opening-account
 * Opening Account stays. leftover-pick-before Choose your team stays.
 * leftover-offline extras and leftover-hub extras stay off these FILES —
 * do not gold leftover-hub + leftover-offline pairs together. leftover-help
 * extras stay off leftover-help FILES. leftover-cad extras stay off these
 * FILES. leftover-cad-setup-copy extras stay off these FILES. leftover-product
 * extras stay off these FILES. leftover-ai-keys extras stay off these FILES.
 * leftover-discord extras stay off these FILES. leftover-slack extras stay
 * off these FILES. leftover-setup extras stay off these FILES. leftover-related
 * extras stay off these FILES. leftover-connections extras stay off these
 * FILES. leftover-alumni extras stay off these FILES. leftover-connectors
 * extras stay off these FILES. leftover-student-buttons extras stay off these
 * FILES. leftover-invites extras stay. leftover-admin skip-list Global Team
 * Manager stays. leftover-my-day Loading My Day stays. Internal webhookUrl
 * stays.
 */
const FILES = ["app/api/account/route.ts"] as const;

describe("leftover student Account Slack chrome", () => {
  it("drops leftover Slack webhook dumps and keeps Slack channel link extras", () => {
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
    const src = readFileSync(join(WEB, "app/api/account/route.ts"), "utf8");
    expect(src).toMatch(/Slack channel link/);
    expect(src).toMatch(/Choose your team/);
    expect(src).toMatch(/webhookUrl/);
  });
});
