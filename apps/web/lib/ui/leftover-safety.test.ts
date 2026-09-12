import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

/**
 * Leftover student Safety incidents titles after leftover-media.
 * /incidents is not a hub label; student chrome stays sentence-case of
 * the leftover Title-Case name. Hub Safety log, leftover-kit Safety,
 * leftover-build Incidents, leftover-media Photos & video, leftover-fmea
 * Failure log, leftover-pick-before Choose your team, and
 * leftover-help-workspace Connect TBA stay. leftover-scout-more
 * Accuracy / Cross-check / Disagreements / Data impact / Heat signals /
 * Assisted count stay. Routes stay. Do not invent a last-snapshot.
 */
const FILES = [
  "app/incidents/incidents-client.tsx",
  "app/incidents/page.tsx",
  "app/safety/safety-client.tsx",
  "app/safety-training/safety-training-client.tsx",
  "lib/offline/shell-routes.ts",
] as const;

describe("leftover student safety-incidents chrome", () => {
  it("does not print leftover Safety Incident Log titles", () => {
    for (const rel of FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/Safety Incident Log/);
      expect(src, rel).not.toMatch(/Safety Incidents/);
    }
    const incidents = readFileSync(join(WEB, "app/incidents/incidents-client.tsx"), "utf8");
    expect(incidents).toMatch(/title="Safety incidents"/);
    expect(incidents).toMatch(/feature="Safety incidents"/);
    expect(incidents).toMatch(/Opening Safety incidents/);
    expect(incidents).not.toMatch(/title="Loading/);
    expect(incidents).toMatch(/Choose your team/);
    expect(incidents).toMatch(/Failure log/);
    expect(incidents).not.toMatch(/Open FMEA/);
    const safety = readFileSync(join(WEB, "app/safety/safety-client.tsx"), "utf8");
    expect(safety).toMatch(/title="Safety log"/);
    expect(safety).toMatch(/Safety incidents/);
    expect(safety).toMatch(/Safety training/);
    const training = readFileSync(
      join(WEB, "app/safety-training/safety-training-client.tsx"),
      "utf8",
    );
    expect(training).toMatch(/Safety incidents/);
    expect(training).toMatch(/Safety log/);
    const routes = readFileSync(join(WEB, "lib/offline/shell-routes.ts"), "utf8");
    expect(routes).toMatch(/if \(bare\.startsWith\("\/incidents"\)\) return "Safety incidents"/);
  });
});
