/**
 * Source lock for leftover student chrome that still said "Pick a team"
 * after PRs #2–#32. Join-or-select lives in #11/#12 — not redone here.
 * "Pick a teammate" (duties) is a person picker and stays.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB_ROOT = join(__dirname, "..", "..");

const FILES = [
  "components/app-shell-nav-panel.tsx",
  "app/messages/page.tsx",
  "app/onboarding/onboarding-steps.tsx",
  "lib/alumni/related.ts",
  "lib/bin-shelf-locator/bin-shelf-locator-related.ts",
  "lib/cad-change-radar/cad-change-radar-related.ts",
  "lib/inspection-copilot/inspection-copilot-related.ts",
  "lib/logistics/logistics-related.ts",
  "lib/matching-gift-finder/matching-gift-finder-related.ts",
  "lib/rule-impact/compute-rule-impact.ts",
  "lib/schedule/schedule-related.ts",
  "lib/scout-accuracy/scout-accuracy-related.ts",
  "lib/scout-coverage-live/scout-coverage-live-related.ts",
  "lib/scout-crossval/scout-crossval-related.ts",
  "lib/scout-data-impact/scout-data-impact-related.ts",
  "lib/scout-disagreements/scout-disagreements-related.ts",
  "lib/scouting/qr-handoff-related.ts",
  "lib/sponsor-renewal-roi/sponsor-renewal-roi-related.ts",
  "lib/team-data/team-data-related.ts",
  "lib/tuning-autopilot/compute-tuning-autopilot.ts",
  "lib/visit-invites/visit-related.ts",
] as const;

describe("leftover student chrome says Choose your team", () => {
  it("does not tell the reader to Pick a team", () => {
    for (const rel of FILES) {
      const src = readFileSync(join(WEB_ROOT, rel), "utf8");
      expect(src, rel).not.toMatch(/\bPick a team\b/);
    }
  });

  it("does not say OAuth to students on the onboarding GitHub hint", () => {
    const src = readFileSync(join(WEB_ROOT, "app/onboarding/onboarding-steps.tsx"), "utf8");
    expect(src).toMatch(/Team → GitHub/);
    expect(src).not.toMatch(/\bOAuth\b/);
    expect(src).not.toMatch(/\bencrypted PAT\b/);
  });

  it("nav chip and chat empty use Choose your team", () => {
    const nav = readFileSync(join(WEB_ROOT, "components/app-shell-nav-panel.tsx"), "utf8");
    expect(nav).toMatch(/Choose your team/);
    const chat = readFileSync(join(WEB_ROOT, "app/messages/page.tsx"), "utf8");
    expect(chat).toMatch(/Choose your team to open chat/);
  });
});
