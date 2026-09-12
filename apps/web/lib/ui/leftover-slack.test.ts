import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

/**
 * Leftover student Slack webhook chrome after leftover-discord.
 * leftover-invites extras stay. leftover-offline Slack stays.
 * leftover-offline extras and leftover-hub extras stay off these FILES
 * — do not gold leftover-hub + leftover-offline pairs together.
 * leftover-help extras stay off leftover-help FILES. leftover-cad extras
 * stay off leftover-help FILES. leftover-cad-setup-copy extras stay off
 * leftover-help FILES. leftover-product extras stay off these FILES.
 * leftover-ai-keys extras stay off these FILES. leftover-discord extras
 * stay off these FILES. leftover-opening extras stay off these FILES.
 * leftover-student-buttons extras stay off these FILES. leftover-admin
 * skip-list Global Team Manager stays. leftover-my-day Loading My Day
 * stays.
 */
const FILES = ["app/team/slack/slack-client.tsx"] as const;

describe("leftover student Slack chrome", () => {
  it("drops leftover Incoming webhook dumps and keeps Slack extras", () => {
    for (const rel of FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/Incoming webhook/);
      expect(src, rel).not.toMatch(/hooks\.slack\.com/);
      expect(src, rel).not.toMatch(/SLACK_SIGNING_SECRET/);
      expect(src, rel).not.toMatch(/Setup required/);
      expect(src, rel).not.toMatch(/VANTAGE \//);
      expect(src, rel).not.toMatch(/primary-action/);
      expect(src, rel).not.toMatch(/Team admin/);
    }
    const src = readFileSync(join(WEB, "app/team/slack/slack-client.tsx"), "utf8");
    expect(src).toMatch(/Slack channel link/);
    expect(src).toMatch(/title="Slack"/);
    expect(src).toMatch(/feature="Slack"/);
    const offline = readFileSync(join(WEB, "lib/offline/shell-routes.ts"), "utf8");
    expect(offline).toMatch(/if \(bare\.startsWith\("\/team\/slack"\)\) return "Slack"/);
  });
});
