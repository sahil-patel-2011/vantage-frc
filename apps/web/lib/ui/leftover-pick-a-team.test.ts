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
    // Names where to connect it, in words a student reads. The wording moved
    // from "Team → GitHub" to "Team, then GitHub" (a screen reader says the
    // arrow as "right arrow"); either says where to go, which is the point.
    expect(src).toMatch(/Team(, then| →) GitHub/);
    expect(src).toMatch(/githubConnectionHref\(/);
    expect(src).not.toMatch(/\bOAuth\b/);
    expect(src).not.toMatch(/\bencrypted PAT\b/);
  });

  it("team context is a label, not a switcher, and switching teams lives in Settings", () => {
    const nav = readFileSync(join(WEB_ROOT, "components/app-shell-nav-panel.tsx"), "utf8");
    // A6-15 had three team controls with different destinations. db5f7d5ec settled it: the shell
    // shows the current team as a label, and switching lives in Settings → Your teams.
    expect(nav).toMatch(/<div className="soft-org-chip" aria-label=\{`Current team — \$\{orgLabel\}`\}>/);
    expect(nav).toMatch(/"Choose your team"/);
    expect(nav).not.toMatch(/aria-expanded=\{workspaceOpen\}/);
    for (const rel of ["components/app-shell-nav-panel.tsx", "components/app-shell.tsx", "components/app-shell-topbar.tsx"]) {
      const src = readFileSync(join(WEB_ROOT, rel), "utf8");
      expect(src, rel).not.toMatch(/workspacePickerHref|onOpenTeams|Switch team/);
    }
    // The sidebar's team card is the one way to another team: it opens Your teams. (It used to
    // say "Team overview" and open the team calendar, a third way to the same page.)
    expect(readFileSync(join(WEB_ROOT, "components/app-shell-sidebar.tsx"), "utf8")).toMatch(/href=\{withOrgHref\("\/account\/teams", orgId\)\}/);
    expect(readFileSync(join(WEB_ROOT, "app/workspace/page.tsx"), "utf8")).toMatch(/href: "\/account\/teams"/);
    expect(readFileSync(join(WEB_ROOT, "lib/nav/settings-nav.ts"), "utf8")).toContain('/account/teams');
    const chat = readFileSync(join(WEB_ROOT, "app/messages/page.tsx"), "utf8");
    expect(chat).toMatch(/Choose your team to open chat/);
  });
});
