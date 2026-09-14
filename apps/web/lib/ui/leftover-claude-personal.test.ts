import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

/**
 * Your Claude Code on the AI subscription bridge page. Page / hub / Help
 * titles stay leftover-offline **AI subscription bridge**, leftover-hub
 * **Subscription bridge**, leftover-help-emdash-last **AI subscription
 * bridge**. leftover-help FILES stay articles.ts only. leftover-cad-setup-copy
 * extras stay off these FILES. leftover-student-copy extras stay.
 * leftover-student-buttons extras stay. leftover-product extras stay off
 * leftover-product FILES. leftover-opening-awards Opening Reimbursements stays.
 */
const FILES = [
  "app/team/ai-bridge/ai-bridge-client.tsx",
  "lib/cad/personal-claude-copy.ts",
] as const;

describe("leftover Your Claude Code on the subscription bridge", () => {
  it("keeps the page title and paints Your Claude Code without leftover chrome", () => {
    for (const rel of FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/Setup required/);
      expect(src, rel).not.toMatch(/VANTAGE \//);
      expect(src, rel).not.toMatch(/subscription bridge —/);
    }
    const copy = readFileSync(join(WEB, "lib/cad/personal-claude-copy.ts"), "utf8");
    expect(copy).toMatch(/Your Claude Code/);
    expect(copy).toMatch(/Only their turns/);
    const client = readFileSync(join(WEB, "app/team/ai-bridge/ai-bridge-client.tsx"), "utf8");
    expect(client).toMatch(/title="AI subscription bridge"/);
    expect(client).toMatch(/feature="AI subscription bridge"/);
    expect(client).toMatch(/PERSONAL_CLAUDE_TITLE/);
    expect(client).toMatch(/Choose your team/);
    expect(client).not.toMatch(/ONSHAPE_|vantage-cad|key_source|\bCLI\b/);
    expect(client).not.toMatch(/primary-action/);
    const articles = readFileSync(join(WEB, "lib/help/articles.ts"), "utf8");
    expect(articles).toMatch(/title: "AI subscription bridge"/);
    expect(articles).toMatch(/heading: "Your Claude Code"/);
    expect(articles).not.toMatch(/Claude Code CLI/);
    expect(articles).not.toMatch(/Codex CLI/);
    const help = readFileSync(join(WEB, "lib/help/section-help.ts"), "utf8");
    expect(help).toMatch(/title: "Subscription bridge"/);
    expect(help).toMatch(/Your Claude Code/);
    expect(help).not.toMatch(/Claude Code CLI/);
    expect(help).not.toMatch(/Codex CLI/);
  });
});
