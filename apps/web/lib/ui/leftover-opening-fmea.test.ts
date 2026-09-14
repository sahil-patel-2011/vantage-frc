import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

/**
 * Leftover student EmptyState title="Loading…" boards after leftover
 * opening-path. Hub labels stay Failure log, Fundraisers, and Security.
 * leftover-fmea Failure log extras and leftover-lxi extras stay on
 * fmea-client. leftover-opening-path Opening Recognition,
 * leftover-opening-wire Opening Auto routines, leftover-opening-build
 * Opening Bring-up, leftover-opening-calc Opening Gearbox calculator,
 * leftover-pick-before Choose your team stay. leftover-admin skip-list
 * Global Team Manager stays. leftover-my-day Loading My Day stays (hub
 * My Day). Hub Schema A/B stays. leftover-fmea-hub extras stay. Do not
 * rewrite leftover-fmea hub to Robot. leftover-offline extras and
 * leftover-hub extras stay off these FILES. Routes stay. Do not invent
 * a last-snapshot.
 */
const FILES = [
  "app/fmea/fmea-client.tsx",
  "app/fundraisers/fundraisers-client.tsx",
  "app/security/security-client.tsx",
] as const;

describe("leftover student opening-fmea chrome", () => {
  it("does not print leftover EmptyState Loading titles", () => {
    for (const rel of FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/title="Loading/);
      expect(src, rel).not.toMatch(/title: "Loading/);
      expect(src, rel).not.toMatch(/Open FMEA/);
      expect(src, rel).not.toMatch(/feature="FMEA"/);
      expect(src, rel).not.toMatch(/L×I/);
    }
    const log = readFileSync(join(WEB, "app/fmea/fmea-client.tsx"), "utf8");
    expect(log).toMatch(/Opening Failure log/);
    expect(log).toMatch(/title="Failure log"/);
    expect(log).toMatch(/feature="Failure log"/);
    expect(log).toMatch(/How often/);
    expect(log).toMatch(/How bad/);
    expect(log).toMatch(/How hard to notice/);
    expect(log).toMatch(/getFeatureSnapshot[\s\S]*"fmea"/);
    const money = readFileSync(join(WEB, "app/fundraisers/fundraisers-client.tsx"), "utf8");
    expect(money).toMatch(/Opening Fundraisers/);
    expect(money).toMatch(/<h1>Fundraisers<\/h1>/);
    expect(money).toMatch(/feature="Fundraisers"/);
    const security = readFileSync(join(WEB, "app/security/security-client.tsx"), "utf8");
    expect(security).toMatch(/Opening Security/);
    expect(security).toMatch(/title="Security"/);
    expect(security).toMatch(/feature="Security"/);
  });
});
