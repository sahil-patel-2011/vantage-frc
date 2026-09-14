import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

/**
 * Leftover student Team setup webhook chrome after leftover-slack.
 * leftover-opening-people Opening Team setup extras stay.
 * leftover-people-titles extras stay. leftover-offline Team setup stays.
 * leftover-offline extras and leftover-hub extras stay off these FILES
 * — do not gold leftover-hub + leftover-offline pairs together.
 * leftover-help extras stay off leftover-help FILES. leftover-cad extras
 * stay off leftover-help FILES. leftover-cad-setup-copy extras stay off
 * leftover-help FILES. leftover-product extras stay off these FILES.
 * leftover-ai-keys extras stay off these FILES. leftover-discord extras
 * stay off these FILES. leftover-slack extras stay off these FILES.
 * leftover-invites extras stay off these FILES. leftover-student-buttons
 * extras stay off these FILES. leftover-admin skip-list Global Team
 * Manager stays. leftover-my-day Loading My Day stays.
 */
const FILES = ["app/team/getting-started/getting-started-client.tsx"] as const;

describe("leftover student Team setup chrome", () => {
  it("drops leftover channel webhook and keeps Opening Team setup extras", () => {
    for (const rel of FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/channel webhook/i);
      expect(src, rel).not.toMatch(/Setup required/);
      expect(src, rel).not.toMatch(/VANTAGE \//);
      expect(src, rel).not.toMatch(/primary-action/);
    }
    const src = readFileSync(join(WEB, "app/team/getting-started/getting-started-client.tsx"), "utf8");
    expect(src).toMatch(/Discord channel link/);
    expect(src).toMatch(/Opening Team setup/);
    expect(src).toMatch(/"Team setup"/);
    expect(src).toMatch(/feature="Team setup"/);
    const offline = readFileSync(join(WEB, "lib/offline/shell-routes.ts"), "utf8");
    expect(offline).toMatch(/if \(bare\.startsWith\("\/team\/getting-started"\)\) return "Team setup"/);
  });
});
