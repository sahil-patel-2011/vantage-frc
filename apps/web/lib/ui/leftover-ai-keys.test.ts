import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

/**
 * Leftover student AI keys chrome after leftover-product Local CLI.
 * Page title is leftover-offline AI keys. leftover-hub API keys stays.
 * leftover-opening-join Opening API keys stays. leftover-help Your AI keys
 * stays. leftover-offline extras and leftover-hub extras stay off these
 * FILES — do not gold leftover-hub + leftover-offline pairs together.
 * leftover-help extras stay off leftover-help FILES. leftover-cad extras
 * stay off leftover-help FILES. leftover-cad-setup-copy extras stay off
 * leftover-help FILES. leftover-product extras stay. leftover-student-copy
 * extras stay. leftover-student-buttons extras stay. leftover-invites
 * extras stay. leftover-admin skip-list Global Team Manager stays.
 * leftover-my-day Loading My Day stays.
 */
const FILES = [
  "app/team/ai-keys/ai-keys-client.tsx",
  "app/team/ai-keys/page.tsx",
  "app/ai/autonomous-agent-panel.tsx",
] as const;

describe("leftover student AI keys chrome", () => {
  it("drops leftover AI API keys and keeps hub / opening / Help extras", () => {
    for (const rel of FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/AI API keys/);
      expect(src, rel).not.toMatch(/Setup required/);
      expect(src, rel).not.toMatch(/VANTAGE \//);
      expect(src, rel).not.toMatch(/primary-action/);
    }
    const client = readFileSync(join(WEB, "app/team/ai-keys/ai-keys-client.tsx"), "utf8");
    expect(client).toMatch(/title="AI keys"/);
    expect(client).toMatch(/\{\s*" \/ API keys"\s*\}/);
    expect(client).toMatch(/Opening API keys/);
    expect(client).not.toMatch(/title="AI API keys"/);
    const page = readFileSync(join(WEB, "app/team/ai-keys/page.tsx"), "utf8");
    expect(page).toMatch(/title: "AI keys"/);
    expect(page).not.toMatch(/title: "AI API keys"/);
    const agent = readFileSync(join(WEB, "app/ai/autonomous-agent-panel.tsx"), "utf8");
    expect(agent).toMatch(/under AI keys/);
    expect(agent).toMatch(/Open AI keys/);

    const related = readFileSync(join(WEB, "lib/ai-keys/ai-keys-related.ts"), "utf8");
    expect(related).toMatch(/Opening API keys/);
    expect(related).toMatch(/Choose your team/);
    const hubs = readFileSync(join(WEB, "lib/nav/hubs.ts"), "utf8");
    expect(hubs).toMatch(/id: "ai-keys", label: "API keys"/);
    const offline = readFileSync(join(WEB, "lib/offline/shell-routes.ts"), "utf8");
    expect(offline).toMatch(/if \(bare\.startsWith\("\/team\/ai-keys"\)\) return "AI keys"/);
    const articles = readFileSync(join(WEB, "lib/help/articles.ts"), "utf8");
    expect(articles).toMatch(/title: "Your AI keys"/);
    expect(articles).not.toMatch(/title: "Your AI keys and Automode"/);

    const usage = readFileSync(join(WEB, "app/team/usage/usage-client.tsx"), "utf8");
    expect(usage).toMatch(/local_cli: "This computer"/);
    expect(usage).not.toMatch(/Local CLI/);
    expect(usage).not.toMatch(/Setup required/);
    const keysUsage = readFileSync(join(WEB, "app/team/ai-usage/ai-usage-client.tsx"), "utf8");
    expect(keysUsage).toMatch(/local_cli: "This computer"/);
    expect(keysUsage).not.toMatch(/Local CLI/);
    expect(keysUsage).not.toMatch(/AI API keys/);
    expect(keysUsage).toMatch(/Open AI keys/);
    expect(keysUsage).toMatch(/Needs setup/);
    expect(keysUsage).toMatch(/Choose your team/);
    expect(keysUsage).not.toMatch(/Setup required/);
    expect(keysUsage).not.toMatch(/Hosted by Vantage/);
    expect(keysUsage).not.toMatch(/primary-action/);
    const printChrome = readFileSync(join(WEB, "app/print-farm/print-farm-chrome.tsx"), "utf8");
    expect(printChrome).toMatch(/title="Print farm"/);
  });
});
