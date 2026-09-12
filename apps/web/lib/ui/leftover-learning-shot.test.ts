import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

/**
 * Leftover student Learning — Call Your Shot titles after leftover
 * opening-join. Hub labels stay Learning and Skills. leftover-opening-leaves
 * Opening Learning, leftover-schema-oauth no Setup required / TBA/Statbotics,
 * leftover-ops-more Skills, leftover-pick-before Choose your team,
 * leftover-fmea Failure log stay. leftover-admin skip-list Global Team
 * Manager stays. leftover-my-day Loading My Day stays (hub My Day). Hub
 * Schema A/B stays. Routes stay. Do not invent a last-snapshot.
 */
const FILES = [
  "app/learning/learning-client.tsx",
  "app/learning/page.tsx",
  "lib/manifests/learning.manifest.ts",
  "app/api/learning/mentor/route.ts",
  "app/skills-graph/skills-graph-client.tsx",
  "lib/skills-graph/calibration.ts",
] as const;

describe("leftover student learning-shot chrome", () => {
  it("does not print leftover Call Your Shot titles", () => {
    for (const rel of FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/Call Your Shot/);
      expect(src, rel).not.toMatch(/Learning — Call Your Shot/);
    }
    const learning = readFileSync(join(WEB, "app/learning/learning-client.tsx"), "utf8");
    expect(learning).toMatch(/title="Learning"/);
    expect(learning).toMatch(/Opening Learning/);
    expect(learning).toMatch(/feature="Learning"/);
    expect(learning).toMatch(/Choose your team/);
    expect(learning).not.toMatch(/Setup required/);
    expect(learning).not.toMatch(/TBA\/Statbotics/);
    expect(readFileSync(join(WEB, "app/learning/page.tsx"), "utf8")).toMatch(
      /title: "Learning"/,
    );
    expect(readFileSync(join(WEB, "lib/manifests/learning.manifest.ts"), "utf8")).toMatch(
      /title: "Learning"/,
    );
    expect(readFileSync(join(WEB, "app/api/learning/mentor/route.ts"), "utf8")).toMatch(
      /Join a team to see Learning activity/,
    );
    const skills = readFileSync(join(WEB, "app/skills-graph/skills-graph-client.tsx"), "utf8");
    expect(skills).toMatch(/title="Skills"/);
    expect(skills).toMatch(/feature="Skills"/);
    expect(skills).toMatch(/Opening Skills/);
    expect(skills).toMatch(/>Prediction calibration</);
    expect(skills).not.toMatch(/title="Loading/);
    expect(skills).not.toMatch(/Skills & Mentorship Graph/);
    expect(readFileSync(join(WEB, "lib/skills-graph/calibration.ts"), "utf8")).toMatch(
      /Learning calibration:/,
    );
  });
});
