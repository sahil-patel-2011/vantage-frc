import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

/**
 * Leftover student chrome em-dash titles after leftover help-emdash-last.
 * Ask AI tooltip / Edit Home aria-label / Our alliance section drop leftover
 * Ask AI — / Edit Home — / Our alliance — titles. leftover-help-emdash
 * extras stay off these FILES. leftover-help-emdash-more extras,
 * leftover-help-emdash-rest extras, leftover-help-emdash-last extras stay
 * off these FILES. leftover-fmea-briefing extras and leftover-epa extras
 * stay on briefing-client. leftover-opening-intel Opening Briefing extras
 * stay off these FILES. leftover-offline extras and leftover-hub extras
 * stay off these FILES. leftover-opening-mismatch Opening Blueprint,
 * leftover-pick-before Choose your team, leftover-fmea Failure log stay.
 * leftover-admin skip-list Global Team Manager stays. leftover-my-day
 * Loading My Day stays (hub My Day). Hub Schema A/B stays.
 * leftover-safety Safety incidents stays. Routes stay. Do not invent a
 * last-snapshot.
 */
const FILES = [
  "components/app-shell-topbar.tsx",
  "app/dashboard/dashboard-home-view.tsx",
  "app/briefing/briefing-client.tsx",
] as const;

describe("leftover student chrome em-dash titles", () => {
  it("does not print leftover Ask AI Edit Home or Our alliance em-dash titles", () => {
    for (const rel of FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/title="Ask AI —/);
      expect(src, rel).not.toMatch(/aria-label="Edit Home —/);
      expect(src, rel).not.toMatch(/title="Our alliance —/);
      expect(src, rel).not.toMatch(/Team admin/);
    }
    const topbar = readFileSync(join(WEB, "components/app-shell-topbar.tsx"), "utf8");
    expect(topbar).toMatch(/title="Ask AI"/);
    expect(topbar).toMatch(/aria-label="Ask AI"/);
    const home = readFileSync(join(WEB, "app/dashboard/dashboard-home-view.tsx"), "utf8");
    expect(home).toMatch(/aria-label="Edit Home"/);
    const briefing = readFileSync(join(WEB, "app/briefing/briefing-client.tsx"), "utf8");
    expect(briefing).toMatch(/title="Our alliance"/);
    expect(briefing).not.toMatch(/Open FMEA/);
    expect(briefing).not.toMatch(/\bRPN\b/);
    expect(briefing).toMatch(/Failure log|failure risk|failure risks/);
    expect(briefing).toMatch(/studentRatingLabel/);
    expect(briefing).toMatch(/our rating/);
    expect(briefing).toMatch(/sync season ratings/);
    expect(briefing).not.toMatch(/\bTBA\b/);
    expect(briefing).not.toMatch(/\bEPA\b/);
  });
});
