import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

/**
 * Leftover student chrome: Code coach, Discord, Support, Team profile,
 * Chat limits, and Team AI keys / memory / policy still used
 * className="primary-action". Discord also printed lowercase setup required.
 * leftover-ai-keys extras stay. leftover-ai-keys-openai extras stay.
 * leftover-opening-join Opening API keys stays. leftover-hub API keys stays.
 * leftover-offline AI keys stays. leftover-help Your AI keys stays.
 */
const FILES = [
  "app/code/code-coach-panel.tsx",
  "app/team/discord/discord-client.tsx",
  "app/team/discord/page.tsx",
  "app/support/support-tickets-client.tsx",
  "app/team/team-profile-panel.tsx",
  "app/team/budgets/budget-client.tsx",
  "app/team/ai-keys/ai-keys-provider-card.tsx",
  "app/team/ai-keys/ai-keys-ready-view.tsx",
  "app/team/ai-keys/ai-keys.css",
  "app/team/ai-memory/ai-memory-client.tsx",
  "app/team/ai-policy/ai-policy-client.tsx",
  "app/team/security/capabilities-client.tsx",
  "app/team/security/hub-access-client.tsx",
] as const;

describe("leftover student Button chrome", () => {
  it("does not print leftover mill prefix, Setup required, or primary-action", () => {
    for (const rel of FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/Setup required/);
      expect(src, rel).not.toMatch(/setup required/);
      expect(src, rel).not.toMatch(/VANTAGE \//);
      expect(src, rel).not.toMatch(/primary-action/);
    }
  });
});
