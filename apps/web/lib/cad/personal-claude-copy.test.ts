import { describe, expect, it } from "vitest";
import {
  PERSONAL_CLAUDE_DESCRIPTION,
  PERSONAL_CLAUDE_NOT_TEAM,
  PERSONAL_CLAUDE_PAIR,
  PERSONAL_CLAUDE_TITLE,
} from "./personal-claude-copy";

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
});
