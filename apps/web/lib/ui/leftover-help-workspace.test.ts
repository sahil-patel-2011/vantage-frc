import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SECTION_HELP } from "../help/section-help";
import { expectPlainCopy } from "./copy-assertions";

const WEB = join(__dirname, "..", "..");

/**
 * Leftover student Help / Workspace / Account chrome. Connect TBA stays the
 * official connector name in Help integrations. Do not invent a last-snapshot.
 */
const STRICT_FILES = [
  "lib/help/section-help.ts",
  "app/workspace/page.tsx",
  "app/account/account-client.tsx",
  "app/video/video-client.tsx",
  "app/team-tags/team-tags-client.tsx",
  "app/exports/export-client.tsx",
] as const;

describe("leftover student Help / Workspace TBA chrome", () => {
  it("does not print TBA/Statbotics or The Blue Alliance on this family", () => {
    for (const rel of STRICT_FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/TBA\/Statbotics/);
      expect(src, rel).not.toMatch(/\bTBA\b/);
      expect(src, rel).not.toMatch(/Statbotics/);
      expect(src, rel).not.toMatch(/The Blue Alliance/);
      expect(src, rel).not.toMatch(/Season EPA/);
      expect(src, rel).not.toMatch(/team_event_metrics/);
    }
  });

  it("help articles drop TBA/Statbotics and team_event_metrics", () => {
    const src = readFileSync(join(WEB, "lib/help/articles.ts"), "utf8");
    expect(src).not.toMatch(/TBA\/Statbotics/);
    expect(src).not.toMatch(/team_event_metrics/);
    expect(src).not.toMatch(/Season EPA/);
    expect(src).toMatch(/Connect TBA/);
    expect(src).toMatch(/Open Event day/);
  });

  it("section help stays student-readable", () => {
    const command = SECTION_HELP.find((s) => s.id === "competition.command");
    const strategy = SECTION_HELP.find((s) => s.id === "competition.strategy");
    expect(command?.what).toBeTruthy();
    expect(strategy?.what).toBeTruthy();
    expectPlainCopy(command!.what);
    expectPlainCopy(strategy!.what);
    const help = readFileSync(join(WEB, "lib/help/section-help.ts"), "utf8");
    expect(help).toMatch(/label: "Match cards"/);
  });
});
