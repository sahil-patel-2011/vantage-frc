import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = __dirname;

describe("Home last snapshot stays on the phone", () => {
  it("reads and writes the dashboard IndexedDB feature cache", () => {
    const src = readFileSync(join(DIR, "use-dashboard-home-state.ts"), "utf8");
    expect(src).toMatch(/getFeatureSnapshot/);
    expect(src).toMatch(/putFeatureSnapshot/);
    expect(src).toMatch(/"dashboard"/);
    expect(src).toMatch(/FEATURE_API_TIMEOUT_MS/);
    expect(src).toMatch(/AbortSignal\.timeout/);
  });

  it("paints an OfflineBanner on Home and does not claim Synced from cache", () => {
    const src = readFileSync(join(DIR, "dashboard-home-view.tsx"), "utf8");
    expect(src).toMatch(/from ["']\.\.\/\.\.\/components\/offline-banner["']/);
    expect(src).toMatch(/feature="Home"/);
    expect(src).toMatch(/fromCache=\{fromCache\}/);
    expect(src).toMatch(/!fromCache/);
    expect(src).toMatch(/Synced ·/);
  });
});
