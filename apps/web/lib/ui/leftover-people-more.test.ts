import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

/**
 * Leftover student Exit interviews / Driver tryouts / Mentor hours /
 * Onboarding buddy / Matching gifts titles after leftover-business-titles.
 * Hub labels stay Exit interviews, Driver tryouts, Mentor hours,
 * Onboarding buddy, and Matching gifts. Routes stay. Do not invent a
 * last-snapshot.
 */
const FILES = [
  "app/exit-interview/exit-interview-client.tsx",
  "app/exit-interview/page.tsx",
  "lib/manifests/exit-interview.manifest.ts",
  "app/driver-tryouts/driver-tryouts-client.tsx",
  "app/driver-tryouts/page.tsx",
  "lib/manifests/driver-tryouts.manifest.ts",
  "lib/field-reset-timer/field-reset-timer-related.ts",
  "app/mentor-hours/mentor-hours-client.tsx",
  "app/mentor-hours/page.tsx",
  "lib/manifests/mentor-hours.manifest.ts",
  "lib/hours-self-view/hours-self-view-related.ts",
  "app/onboarding-buddy/onboarding-buddy-client.tsx",
  "app/onboarding-buddy/page.tsx",
  "lib/onboarding-buddy/onboarding-buddy-related.ts",
  "lib/manifests/onboarding-buddy.manifest.ts",
  "app/matching-gift-finder/matching-gift-finder-client.tsx",
  "app/matching-gift-finder/page.tsx",
  "lib/matching-gift-finder/matching-gift-finder-related.ts",
  "lib/manifests/matching-gift-finder.manifest.ts",
  "lib/offline/shell-routes.ts",
] as const;

describe("leftover student people-more chrome", () => {
  it("does not print leftover Graduation / Tryouts / Buddy / Finder titles", () => {
    for (const rel of FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/Graduation Exit Interviews/);
      expect(src, rel).not.toMatch(/Exit Interviews/);
      expect(src, rel).not.toMatch(/Driver Tryouts/);
      expect(src, rel).not.toMatch(/Mentor Hours & Engagement/);
      expect(src, rel).not.toMatch(/Mentor Hours/);
      expect(src, rel).not.toMatch(/Onboarding Buddy/);
      expect(src, rel).not.toMatch(/Matching Gift Multiplier Finder/);
      expect(src, rel).not.toMatch(/Matching Gift Finder/);
    }
    const exit = readFileSync(join(WEB, "app/exit-interview/exit-interview-client.tsx"), "utf8");
    expect(exit).toMatch(/title="Exit interviews"/);
    expect(exit).toMatch(/feature="Exit interviews"/);
    const tryouts = readFileSync(join(WEB, "app/driver-tryouts/driver-tryouts-client.tsx"), "utf8");
    expect(tryouts).toMatch(/title="Driver tryouts"/);
    expect(tryouts).toMatch(/feature="Driver tryouts"/);
    const hours = readFileSync(join(WEB, "app/mentor-hours/mentor-hours-client.tsx"), "utf8");
    expect(hours).toMatch(/title="Mentor hours"/);
    expect(hours).toMatch(/feature="Mentor hours"/);
    const buddy = readFileSync(join(WEB, "app/onboarding-buddy/onboarding-buddy-client.tsx"), "utf8");
    expect(buddy).toMatch(/title="Onboarding buddy"/);
    expect(buddy).toMatch(/feature="Onboarding buddy"/);
    const gifts = readFileSync(
      join(WEB, "app/matching-gift-finder/matching-gift-finder-client.tsx"),
      "utf8",
    );
    expect(gifts).toMatch(/title="Matching gifts"/);
    expect(gifts).toMatch(/feature="Matching gifts"/);
    const related = readFileSync(join(WEB, "lib/onboarding-buddy/onboarding-buddy-related.ts"), "utf8");
    expect(related).toMatch(/Opening Onboarding buddy/);
    expect(related).not.toMatch(/title="Loading/);
    expect(related).toMatch(/Choose your team/);
  });
});
