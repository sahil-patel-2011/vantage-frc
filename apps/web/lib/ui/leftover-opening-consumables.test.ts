import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

/**
 * Leftover student EmptyState title="Loading…" boards after leftover
 * opening-background. Hub / leftover-offline labels stay Consumables,
 * Safety, Safety log, and Data-source health. leftover-kit-titles Safety
 * extras, leftover-safety extras, leftover-tba extras stay.
 * leftover-opening-background Opening Team background,
 * leftover-opening-cad-setup Opening CAD setup, leftover-pick-before
 * Choose your team, leftover-fmea Failure log stay. leftover-admin
 * skip-list Global Team Manager stays. leftover-my-day Loading My Day
 * stays (hub My Day). Hub Schema A/B stays. leftover-hub Degraded mode
 * stays off these FILES. leftover-offline extras and leftover-hub extras
 * stay off these FILES. leftover-community-impact Impact stays. Routes
 * stay. Do not invent a last-snapshot.
 */
const FILES = [
  "app/spares/spares-client.tsx",
  "app/safety-training/safety-training-client.tsx",
  "app/safety/safety-client.tsx",
  "app/degraded-mode/degraded-mode-client.tsx",
] as const;

describe("leftover student opening-consumables chrome", () => {
  it("does not print leftover EmptyState Loading titles", () => {
    for (const rel of FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/title="Loading/);
      expect(src, rel).not.toMatch(/title: "Loading/);
      expect(src, rel).not.toMatch(/Consumables & Spares/);
      expect(src, rel).not.toMatch(/TBA\/Statbotics/);
      expect(src, rel).not.toMatch(/\bTBA\b/);
    }
    const spares = readFileSync(join(WEB, "app/spares/spares-client.tsx"), "utf8");
    expect(spares).toMatch(/Opening Consumables/);
    expect(spares).toMatch(/title="Consumables"/);
    expect(spares).toMatch(/feature="Consumables"/);
    const training = readFileSync(
      join(WEB, "app/safety-training/safety-training-client.tsx"),
      "utf8",
    );
    expect(training).toMatch(/Opening Safety/);
    expect(training).toMatch(/title="Safety"/);
    expect(training).toMatch(/feature="Safety"/);
    expect(training).toMatch(/Safety incidents/);
    expect(training).toMatch(/Safety log/);
    const safety = readFileSync(join(WEB, "app/safety/safety-client.tsx"), "utf8");
    expect(safety).toMatch(/Opening Safety log/);
    expect(safety).toMatch(/title="Safety log"/);
    expect(safety).toMatch(/Safety incidents/);
    const health = readFileSync(join(WEB, "app/degraded-mode/degraded-mode-client.tsx"), "utf8");
    expect(health).toMatch(/Opening Data-source health/);
    expect(health).toMatch(/title="Data-source health"/);
    expect(health).toMatch(/feature="Data-source health"/);
  });
});
