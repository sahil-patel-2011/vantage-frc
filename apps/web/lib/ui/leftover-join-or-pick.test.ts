/**
 * Source lock for leftover student chrome that still said "Join or pick a team"
 * after PRs #2–#33. Those PRs own last-snapshot gold, Join-or-select (#11/#12),
 * and leftover "Pick a team" titles (#4/#12/#33) — not redone here.
 * Scout attach/voice "pick a team" meant the FRC robot being scouted, not the
 * org picker. Duties "Pick a teammate" is a person picker and stays.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB_ROOT = join(__dirname, "..", "..");

const JOIN_OR_PICK_FILES = [
  "lib/retro/retro-related.ts",
  "lib/build-burndown/build-burndown-related.ts",
  "lib/cross-team-scrim/cross-team-scrim-related.ts",
  "lib/editor/pair-related.ts",
  "lib/github/github-related.ts",
  "lib/team/team-admin-related.ts",
  "app/team/admin/page.tsx",
  "lib/ai-chat/ai-chat-related.ts",
] as const;

const SCOUT_ROBOT_FILES = [
  "lib/scouting/attach-media-wire.ts",
  "app/scouting/scout-voice-notes-panel.tsx",
] as const;

describe("leftover student chrome says Choose your team", () => {
  it("does not tell the reader to Join or pick a team", () => {
    for (const rel of JOIN_OR_PICK_FILES) {
      const src = readFileSync(join(WEB_ROOT, rel), "utf8");
      expect(src, rel).not.toMatch(/Join or pick a team/);
      expect(src, rel).not.toMatch(/\bpick a team first\b/i);
    }
  });

  it("setup copy uses Choose your team, not Pick a team", () => {
    for (const rel of JOIN_OR_PICK_FILES) {
      const src = readFileSync(join(WEB_ROOT, rel), "utf8");
      expect(src, rel).toMatch(/Choose your team/);
      expect(src, rel).not.toMatch(/\bPick a team\b/);
    }
  });

  it("Ask AI no-org copy says team, not org", () => {
    const src = readFileSync(join(WEB_ROOT, "lib/ai-chat/ai-chat-related.ts"), "utf8");
    expect(src).toMatch(/saved per team/);
    expect(src).not.toMatch(/saved per org/);
  });

  it("scout attach and voice notes name the robot being scouted", () => {
    for (const rel of SCOUT_ROBOT_FILES) {
      const src = readFileSync(join(WEB_ROOT, rel), "utf8");
      expect(src, rel).toMatch(/choose which robot you are scouting/);
      expect(src, rel).not.toMatch(/pick a team before attaching/i);
    }
  });

  it("form preview photos are stored with this team", () => {
    const src = readFileSync(
      join(WEB_ROOT, "app/scouting/forms/forms-preview.tsx"),
      "utf8",
    );
    expect(src).toMatch(/stored with this team/);
    expect(src).not.toMatch(/stored per organization/);
  });
});
