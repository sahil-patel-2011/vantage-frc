import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

/**
 * Leftover student Discord / Slack next-action webhook chrome after
 * leftover-setup. leftover-discord extras stay off these FILES.
 * leftover-slack extras stay off these FILES. leftover-setup extras stay
 * off these FILES. leftover-opening extras stay off these FILES.
 * leftover-offline extras and leftover-hub extras stay off these FILES
 * — do not gold leftover-hub + leftover-offline pairs together.
 * leftover-help extras stay off leftover-help FILES. leftover-cad extras
 * stay off leftover-help FILES. leftover-cad-setup-copy extras stay off
 * leftover-help FILES. leftover-product extras stay off these FILES.
 * leftover-ai-keys extras stay off these FILES. leftover-invites extras
 * stay off these FILES. leftover-student-buttons extras stay off these
 * FILES. leftover-admin skip-list Global Team Manager stays.
 * leftover-my-day Loading My Day stays.
 */
const FILES = ["lib/discord-related.ts", "lib/slack-related.ts"] as const;

describe("leftover student Discord / Slack next-action chrome", () => {
  it("drops leftover webhook dumps and keeps Discord / Slack channel link extras", () => {
    for (const rel of FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/channel webhook/i);
      expect(src, rel).not.toMatch(/Incoming webhook/i);
      expect(src, rel).not.toMatch(/Incoming Webhooks/);
      expect(src, rel).not.toMatch(/hooks\.slack\.com/);
      expect(src, rel).not.toMatch(/DISCORD_BOT_TOKEN/);
      expect(src, rel).not.toMatch(/SLACK_SIGNING_SECRET/);
      expect(src, rel).not.toMatch(/Setup required/);
      expect(src, rel).not.toMatch(/VANTAGE \//);
      expect(src, rel).not.toMatch(/primary-action/);
    }
    const discord = readFileSync(join(WEB, "lib/discord-related.ts"), "utf8");
    expect(discord).toMatch(/Discord channel link/);
    expect(discord).toMatch(/Needs setup/);
    const slack = readFileSync(join(WEB, "lib/slack-related.ts"), "utf8");
    expect(slack).toMatch(/Slack channel link/);
  });
});
