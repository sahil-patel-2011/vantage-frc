import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

/**
 * Leftover student manifest / Auton paths titles after leftover-learning-shot.
 * Hub labels stay Standup, Shifts, Object chat, Field reset, and Auton paths.
 * leftover-goals-kit Field reset / Standup, leftover-strips-more Shifts,
 * leftover-opening-rest Object chat, leftover-pick-before Choose your team,
 * leftover-fmea Failure log stay. leftover-admin skip-list Global Team
 * Manager stays. leftover-my-day Loading My Day stays (hub My Day). Hub
 * Schema A/B stays. Routes stay. Do not invent a last-snapshot.
 */
const FILES = [
  "lib/manifests/standup-digest.manifest.ts",
  "lib/manifests/shift-balancer.manifest.ts",
  "lib/manifests/scout-voice.manifest.ts",
  "lib/manifests/object-chat-bridge.manifest.ts",
  "lib/manifests/field-reset-timer.manifest.ts",
  "lib/manifests/auton-path-library.manifest.ts",
  "app/api/auton-path-library/route.ts",
  "app/auton-path-library/auton-path-library-client.tsx",
  "app/standup-digest/standup-digest-client.tsx",
] as const;

describe("leftover student manifest-title chrome", () => {
  it("does not print leftover Title-Case manifest titles", () => {
    for (const rel of FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/Morning Standup Digest/);
      expect(src, rel).not.toMatch(/Scout Shift Load Balancer/);
      expect(src, rel).not.toMatch(/Scout Voice Notes/);
      expect(src, rel).not.toMatch(/Object Chat Bridge/);
      expect(src, rel).not.toMatch(/Field Reset Timer/);
      expect(src, rel).not.toMatch(/Autonomous Path Library/);
    }
    expect(readFileSync(join(WEB, "lib/manifests/standup-digest.manifest.ts"), "utf8")).toMatch(
      /title: "Standup"/,
    );
    expect(readFileSync(join(WEB, "lib/manifests/shift-balancer.manifest.ts"), "utf8")).toMatch(
      /title: "Shifts"/,
    );
    expect(readFileSync(join(WEB, "lib/manifests/scout-voice.manifest.ts"), "utf8")).toMatch(
      /title: "Voice notes"/,
    );
    expect(readFileSync(join(WEB, "lib/manifests/object-chat-bridge.manifest.ts"), "utf8")).toMatch(
      /title: "Object chat"/,
    );
    expect(readFileSync(join(WEB, "lib/manifests/field-reset-timer.manifest.ts"), "utf8")).toMatch(
      /title: "Field reset"/,
    );
    expect(readFileSync(join(WEB, "lib/manifests/auton-path-library.manifest.ts"), "utf8")).toMatch(
      /title: "Auton paths"/,
    );
    const auton = readFileSync(join(WEB, "app/api/auton-path-library/route.ts"), "utf8");
    expect(auton).toMatch(/Could not load Auton paths/);
    expect(auton).toMatch(/Choose your team/);
    expect(auton).toMatch(/Auton paths request failed/);
    const autonClient = readFileSync(
      join(WEB, "app/auton-path-library/auton-path-library-client.tsx"),
      "utf8",
    );
    expect(autonClient).toMatch(/title="Auton paths"/);
    expect(autonClient).toMatch(/feature="Auton paths"/);
    expect(autonClient).toMatch(/Opening Auton paths/);
    expect(autonClient).not.toMatch(/title="Loading/);
    const standup = readFileSync(
      join(WEB, "app/standup-digest/standup-digest-client.tsx"),
      "utf8",
    );
    expect(standup).toMatch(/title="Standup"/);
    expect(standup).toMatch(/feature="Standup"/);
    expect(standup).toMatch(/Opening Standup/);
    expect(standup).not.toMatch(/title="Loading/);
  });
});
