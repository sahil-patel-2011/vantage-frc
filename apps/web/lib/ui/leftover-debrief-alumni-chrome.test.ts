import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { alumniShellCopy } from "../alumni";
import { pitShellCopy } from "../pit";
import { expectPlainCopy } from "./copy-assertions";

const WEB = join(__dirname, "..", "..");

/**
 * Leftover student chrome not skip-list: Match debrief still said
 * VANTAGE / MATCH LOG + Setup required; Alumni still said
 * VANTAGE / ALUMNI NETWORK; Kickoff / Pit still badged Setup required.
 */
const FILES = [
  "app/match-debrief/match-debrief-client.tsx",
  "app/team/alumni/alumni-client.tsx",
  "app/team/alumni/page.tsx",
  "lib/alumni/related.ts",
  "app/kickoff/kickoff-client.tsx",
  "app/pit/page.tsx",
  "app/pit/pit-command-client.tsx",
  "lib/pit/pit-related.ts",
  "app/code/code-ready-view.tsx",
  "app/code/code-bugbot-panel.tsx",
  "app/team/sponsors/sponsors-client.tsx",
  "app/team/finance/finance-client.tsx",
] as const;

describe("leftover Match debrief / Alumni / Kickoff / Pit student chrome", () => {
  it("does not print leftover mill prefix or Setup required on this family", () => {
    for (const rel of FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/Setup required/);
      expect(src, rel).not.toMatch(/VANTAGE \//);
      expect(src, rel).not.toMatch(/primary-action/);
    }
  });

  it("setup badges stay Needs setup", () => {
    expect(alumniShellCopy("setup").badge).toBe("Needs setup");
    expect(pitShellCopy("setup").badge).toBe("Needs setup");
    expectPlainCopy(alumniShellCopy("setup").description);
    expectPlainCopy(pitShellCopy("setup").description);
  });
});
