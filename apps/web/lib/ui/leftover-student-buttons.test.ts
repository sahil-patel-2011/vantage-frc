import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

/**
 * Leftover student chrome: Code coach, Discord, Support, Team profile,
 * and Chat limits still used className="primary-action". Discord also
 * printed lowercase setup required on the posting-path row.
 */
const FILES = [
  "app/code/code-coach-panel.tsx",
  "app/team/discord/discord-client.tsx",
  "app/team/discord/page.tsx",
  "app/support/support-tickets-client.tsx",
  "app/team/team-profile-panel.tsx",
  "app/team/budgets/budget-client.tsx",
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
