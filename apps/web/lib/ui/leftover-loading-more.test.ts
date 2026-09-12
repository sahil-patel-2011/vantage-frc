import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

/**
 * Leftover student Loading Robot Weigh-In / Loading Pair VS Code titles
 * after leftover-sponsor-more. Hub label stays Weigh-in. leftover-cad
 * Pair VS Code stays. leftover-related-more Open Spare kit,
 * leftover-copilot no Inspection Copilot / Match Copilot,
 * leftover-code-coach Code / no Code Coach, leftover-join-or-pick
 * Choose your team stay. Hub My Day / Schema A/B stay. Routes stay.
 * Do not invent a last-snapshot.
 */
const FILES = [
  "lib/robot-weigh-in/robot-weigh-in-related.ts",
  "app/robot-weigh-in/robot-weigh-in-client.tsx",
  "app/api/robot-weigh-in/route.ts",
  "lib/editor/pair-related.ts",
] as const;

describe("leftover student loading-more chrome", () => {
  it("does not print leftover Loading Robot Weigh-In / Pair VS Code titles", () => {
    for (const rel of FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/Loading Robot Weigh-In/);
      expect(src, rel).not.toMatch(/Loading Pair VS Code/);
      expect(src, rel).not.toMatch(/Could not load Robot Weigh-In/);
      expect(src, rel).not.toMatch(/Retry Robot Weigh-In/);
      expect(src, rel).not.toMatch(/title="Loading/);
    }
    const weigh = readFileSync(
      join(WEB, "lib/robot-weigh-in/robot-weigh-in-related.ts"),
      "utf8",
    );
    expect(weigh).toMatch(/Opening Weigh-in/);
    expect(weigh).toMatch(/Could not load Weigh-in/);
    expect(weigh).toMatch(/Retry Weigh-in/);
    expect(weigh).toMatch(/Open Spare kit/);
    expect(weigh).toMatch(/Choose your team/);
    expect(weigh).not.toMatch(/Inspection Copilot/);
    expect(weigh).not.toMatch(/Match Copilot/);
    expect(weigh).not.toMatch(/\bPick a team\b/);
    const client = readFileSync(
      join(WEB, "app/robot-weigh-in/robot-weigh-in-client.tsx"),
      "utf8",
    );
    expect(client).toMatch(/ \/ Weigh-in/);
    expect(client).toMatch(/Opening Weigh-in/);
    const route = readFileSync(join(WEB, "app/api/robot-weigh-in/route.ts"), "utf8");
    expect(route).toMatch(/Could not load Weigh-in/);
    expect(route).toMatch(/Choose your team/);
    const pair = readFileSync(join(WEB, "lib/editor/pair-related.ts"), "utf8");
    expect(pair).toMatch(/Opening Pair VS Code/);
    expect(pair).toMatch(/Choose your team/);
    expect(pair).not.toMatch(/Code Coach/);
    expect(pair).not.toMatch(/Join or pick a team/);
    expect(pair).not.toMatch(/\bPick a team\b/);
  });
});
