import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

/**
 * Leftover student Discord / Slack API webhook chrome after leftover-cad-change-radar.
 * leftover-discord extras stay off leftover-discord.ts. leftover-slack extras stay
 * off leftover-slack.ts. leftover-chat-bridge-connector-contract extras stay.
 * leftover-opening extras stay off these FILES. leftover-opening-comms Opening
 * Discord stays. leftover-opening-account Opening Account stays. leftover-pick-before
 * Choose your team stays. leftover-offline extras and leftover-hub extras stay off
 * these FILES — do not gold leftover-hub + leftover-offline pairs together.
 * leftover-help extras stay off leftover-help FILES. leftover-cad extras stay off
 * these FILES. leftover-cad-change-radar extras stay off these FILES. leftover-cad-
 * setup-copy extras stay off these FILES. leftover-product extras stay off these
 * FILES. leftover-ai-keys extras stay off these FILES. leftover-discord extras stay
 * off these FILES. leftover-slack extras stay off these FILES. leftover-setup extras
 * stay off these FILES. leftover-related extras stay off these FILES. leftover-
 * connections extras stay off these FILES. leftover-alumni extras stay off these
 * FILES. leftover-connectors extras stay off these FILES. leftover-account extras
 * stay off these FILES. leftover-student-buttons extras stay off these FILES.
 * leftover-student-copy extras stay. leftover-invites extras stay. leftover-admin
 * skip-list Global Team Manager stays. leftover-my-day Loading My Day stays.
 * leftover-account-api-related leak regex stays. Internal webhookUrl stays.
 */
const FILES = ["app/api/team/discord/route.ts", "app/api/team/slack/route.ts"] as const;

describe("leftover student Discord Slack API chrome", () => {
  it("drops leftover webhook dumps and keeps Discord / Slack channel link extras", () => {
    for (const rel of FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/channel webhook/i);
      expect(src, rel).not.toMatch(/incoming webhook/i);
      expect(src, rel).not.toMatch(/webhook URL/i);
      expect(src, rel).not.toMatch(/Paste a webhook/);
      expect(src, rel).not.toMatch(/DISCORD_BOT_TOKEN/);
      expect(src, rel).not.toMatch(/SLACK_SIGNING_SECRET/);
      expect(src, rel).not.toMatch(/hooks\.slack\.com/);
      expect(src, rel).not.toMatch(/Integrations → Webhooks/);
      expect(src, rel).not.toMatch(/Setup required/);
      expect(src, rel).not.toMatch(/VANTAGE \//);
      expect(src, rel).not.toMatch(/primary-action/);
      expect(src, rel).not.toMatch(/Team admin/);
    }
    const discord = readFileSync(join(WEB, "app/api/team/discord/route.ts"), "utf8");
    expect(discord).toMatch(/Discord channel link/);
    expect(discord).toMatch(/ACCOUNT_DISCORD_COPY/);
    expect(discord).toMatch(/webhookUrl/);
    const slack = readFileSync(join(WEB, "app/api/team/slack/route.ts"), "utf8");
    expect(slack).toMatch(/Slack channel link/);
    expect(slack).toMatch(/team chat sync/);
    expect(slack).toMatch(/webhookUrl/);
  });
});
