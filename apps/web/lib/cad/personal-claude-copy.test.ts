import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  PERSONAL_CLAUDE_DESCRIPTION,
  PERSONAL_CLAUDE_NOT_TEAM,
  PERSONAL_CLAUDE_PAIR,
  PERSONAL_CLAUDE_TITLE,
} from "./personal-claude-copy";

const WEB = join(__dirname, "..", "..");

describe("personal Claude Code student copy", () => {
  it("stays personal and never dumps CLI or env names", () => {
    const all = [
      PERSONAL_CLAUDE_TITLE,
      PERSONAL_CLAUDE_DESCRIPTION,
      PERSONAL_CLAUDE_PAIR,
      PERSONAL_CLAUDE_NOT_TEAM,
    ].join(" ");
    expect(PERSONAL_CLAUDE_TITLE).toBe("Your Claude Code");
    expect(all).toMatch(/Only their turns/);
    expect(all).not.toMatch(/subscription bridge —/);
    expect(all).not.toMatch(/ONSHAPE_|vantage-cad|Vercel|key_source|OAuth|\bCLI\b/);
  });

  it("paints Your Claude Code on the AI subscription bridge page", () => {
    const src = readFileSync(join(WEB, "app/team/ai-bridge/ai-bridge-client.tsx"), "utf8");
    expect(src).toMatch(/PERSONAL_CLAUDE_TITLE/);
    expect(src).toMatch(/PERSONAL_CLAUDE_DESCRIPTION/);
    expect(src).toMatch(/PERSONAL_CLAUDE_PAIR/);
    expect(src).toMatch(/PERSONAL_CLAUDE_NOT_TEAM/);
    expect(src).toMatch(/title="AI subscription bridge"/);
    expect(src).toMatch(/feature="AI subscription bridge"/);
    expect(src).not.toMatch(/title="Your Claude Code"/);
    expect(src).not.toMatch(/Setup required/);
    expect(src).not.toMatch(/primary-action/);
    expect(src).not.toMatch(/VANTAGE \//);
  });
});
