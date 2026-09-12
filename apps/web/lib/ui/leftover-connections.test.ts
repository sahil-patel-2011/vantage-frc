import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

/**
 * Leftover student Account connections webhook chrome after leftover-related.
 * leftover-invites extras stay (FILES include these files; ban Team admin
 * only). leftover-opening-ops Opening connections stays. leftover-pick-before
 * Choose your team stays. leftover-offline extras and leftover-hub extras
 * stay off these FILES — do not gold leftover-hub + leftover-offline pairs
 * together. leftover-help extras stay off leftover-help FILES. leftover-cad
 * extras stay off these FILES. leftover-cad-setup-copy extras stay off these
 * FILES. leftover-product extras stay off these FILES. leftover-ai-keys
 * extras stay off these FILES. leftover-discord extras stay off these FILES.
 * leftover-slack extras stay off these FILES. leftover-setup extras stay
 * off these FILES. leftover-related extras stay off these FILES.
 * leftover-student-buttons extras stay off these FILES. leftover-admin
 * skip-list Global Team Manager stays. leftover-my-day Loading My Day stays.
 * leftover-account-api-related leak regex stays — do not ban DISCORD_BOT /
 * SLACK_SIGNING here.
 */
const FILES = ["lib/account/connections-related.ts", "lib/account/account-api-related.ts"] as const;

describe("leftover student Account connections chrome", () => {
  it("drops leftover webhook dumps and keeps Opening connections extras", () => {
    for (const rel of FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/channel webhook/i);
      expect(src, rel).not.toMatch(/Discord webhook/);
      expect(src, rel).not.toMatch(/Webhook not saved/);
      expect(src, rel).not.toMatch(/Guild \/ webhook/);
      expect(src, rel).not.toMatch(/Setup required/);
      expect(src, rel).not.toMatch(/VANTAGE \//);
      expect(src, rel).not.toMatch(/primary-action/);
      expect(src, rel).not.toMatch(/Team admin/);
    }
    const connections = readFileSync(join(WEB, "lib/account/connections-related.ts"), "utf8");
    expect(connections).toMatch(/Discord channel link/);
    expect(connections).toMatch(/Slack channel link/);
    expect(connections).toMatch(/Opening connections/);
    expect(connections).toMatch(/Choose your team/);
    const account = readFileSync(join(WEB, "lib/account/account-api-related.ts"), "utf8");
    expect(account).toMatch(/Discord channel link/);
    expect(account).toMatch(/Choose your team/);
    expect(account).toMatch(/DISCORD_BOT/);
    expect(account).toMatch(/SLACK_SIGNING/);
  });
});
