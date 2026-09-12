import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

/**
 * Leftover student Discord webhook chrome after leftover-ai-keys.
 * leftover-opening-comms Opening Discord / title Discord / feature
 * Discord stay. leftover-student-buttons extras stay. leftover-offline
 * Discord stays. leftover-offline extras and leftover-hub extras stay
 * off these FILES — do not gold leftover-hub + leftover-offline pairs
 * together. leftover-help extras stay off leftover-help FILES.
 * leftover-cad extras stay off leftover-help FILES. leftover-cad-setup-copy
 * extras stay off leftover-help FILES. leftover-product extras stay off
 * these FILES. leftover-ai-keys extras stay off these FILES.
 * leftover-invites extras stay. leftover-admin skip-list Global Team
 * Manager stays. leftover-my-day Loading My Day stays.
 */
const FILES = ["app/team/discord/discord-client.tsx"] as const;

describe("leftover student Discord chrome", () => {
  it("drops leftover webhook dumps and keeps Opening Discord extras", () => {
    for (const rel of FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/channel webhook/i);
      expect(src, rel).not.toMatch(/Webhook posting/);
      expect(src, rel).not.toMatch(/api\/webhooks/);
      expect(src, rel).not.toMatch(/Developer Mode/);
      expect(src, rel).not.toMatch(/<span>Webhook<\/span>/);
      expect(src, rel).not.toMatch(/Setup required/);
      expect(src, rel).not.toMatch(/VANTAGE \//);
      expect(src, rel).not.toMatch(/primary-action/);
    }
    const src = readFileSync(join(WEB, "app/team/discord/discord-client.tsx"), "utf8");
    expect(src).toMatch(/Discord channel link/);
    expect(src).toMatch(/Opening Discord/);
    expect(src).toMatch(/title="Discord"/);
    expect(src).toMatch(/feature="Discord"/);
    const offline = readFileSync(join(WEB, "lib/offline/shell-routes.ts"), "utf8");
    expect(offline).toMatch(/if \(bare\.startsWith\("\/team\/discord"\)\) return "Discord"/);
  });
});
