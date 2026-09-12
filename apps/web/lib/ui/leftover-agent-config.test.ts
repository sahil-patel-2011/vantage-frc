import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

/**
 * Leftover student Team agent config chrome after leftover-claude-personal.
 * Hub / Help titles stay Team agent config. leftover-help extras stay off
 * leftover-help FILES. leftover-cad extras stay off leftover-help FILES.
 * leftover-cad-setup-copy extras stay off leftover-help FILES.
 * leftover-help-emdash-rest extras stay. leftover-help-workspace extras stay.
 * leftover-invites extras stay. leftover-student-copy extras stay.
 * leftover-student-buttons extras stay. leftover-product extras stay.
 * leftover-opening extras stay off leftover-help FILES. leftover-admin
 * skip-list Global Team Manager stays. leftover-my-day Loading My Day stays.
 */
const FILES = ["app/team/agent-config/agent-config-client.tsx"] as const;

describe("leftover student Team agent config chrome", () => {
  it("keeps the title and drops vantage-cad CLI dump", () => {
    for (const rel of FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/vantage-cad/);
      expect(src, rel).not.toMatch(/\bCLI\b/);
      expect(src, rel).not.toMatch(/Setup required/);
      expect(src, rel).not.toMatch(/VANTAGE \//);
      expect(src, rel).not.toMatch(/primary-action/);
      expect(src, rel).not.toMatch(/Team agent configuration/);
    }
    const src = readFileSync(join(WEB, "app/team/agent-config/agent-config-client.tsx"), "utf8");
    expect(src).toMatch(/<h1>Team agent config<\/h1>/);
    expect(src).toMatch(/Opening Team agent config/);
    const articles = readFileSync(join(WEB, "lib/help/articles.ts"), "utf8");
    expect(articles).toMatch(/title: "Team agent config"/);
    expect(articles).not.toMatch(/vantage-cad/);
    const help = readFileSync(join(WEB, "lib/help/section-help.ts"), "utf8");
    expect(help).toMatch(/title: "Team agent config"/);
    expect(help).not.toMatch(/vantage-cad/);
  });
});
