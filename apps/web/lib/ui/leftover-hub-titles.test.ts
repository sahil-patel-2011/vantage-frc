import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

/**
 * Leftover student Diagnoser / Advisor / Radar / Factor / Score / Media Kit
 * titles after leftover-judge-sim. Hub labels stay Wiring check, Reuse,
 * Change radar, Bus factor, Readiness, and Media kit. Routes stay.
 * Do not invent a last-snapshot.
 */
const FILES = [
  "app/wiring-diagnoser/wiring-diagnoser-client.tsx",
  "app/wiring-diagnoser/page.tsx",
  "app/api/wiring-diagnoser/route.ts",
  "lib/manifests/wiring-diagnoser.manifest.ts",
  "app/reuse-advisor/reuse-advisor-client.tsx",
  "app/reuse-advisor/page.tsx",
  "app/api/reuse-advisor/route.ts",
  "lib/manifests/reuse-advisor.manifest.ts",
  "app/cad-change-radar/cad-change-radar-client.tsx",
  "app/cad-change-radar/page.tsx",
  "app/api/cad-change-radar/route.ts",
  "lib/cad-change-radar/cad-change-radar-related.ts",
  "lib/manifests/cad-change-radar.manifest.ts",
  "app/bus-factor/bus-factor-client.tsx",
  "app/bus-factor/page.tsx",
  "app/api/bus-factor/route.ts",
  "lib/bus-factor/bus-factor-related.ts",
  "lib/bus-factor/compute-bus-factor.ts",
  "lib/manifests/bus-factor.manifest.ts",
  "app/readiness-score/readiness-score-client.tsx",
  "app/readiness-score/page.tsx",
  "app/api/readiness-score/route.ts",
  "lib/readiness-score/readiness-score-related.ts",
  "lib/readiness-score/compute-readiness-score.ts",
  "lib/manifests/readiness-score.manifest.ts",
  "app/media-kit/media-kit-client.tsx",
  "app/media-kit/page.tsx",
  "app/api/media-kit/route.ts",
  "lib/media-kit/media-kit-related.ts",
  "lib/manifests/media-kit.manifest.ts",
  "lib/offline/shell-routes.ts",
] as const;

describe("leftover student hub-title chrome", () => {
  it("does not print leftover Diagnoser / Advisor / Radar / Factor titles", () => {
    for (const rel of FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/Wiring \/ Power Fault Diagnoser/);
      expect(src, rel).not.toMatch(/Wiring Diagnoser/);
      expect(src, rel).not.toMatch(/wiring diagnoser/i);
      expect(src, rel).not.toMatch(/Reuse Advisor/);
      expect(src, rel).not.toMatch(/CAD Change Impact Radar/);
      expect(src, rel).not.toMatch(/CAD Change Radar/);
      expect(src, rel).not.toMatch(/Bus-Factor & Burnout/);
      expect(src, rel).not.toMatch(/Robot readiness score/);
      expect(src, rel).not.toMatch(/Readiness Score/);
      expect(src, rel).not.toMatch(/Media Kit/);
    }
    const wiring = readFileSync(join(WEB, "app/wiring-diagnoser/wiring-diagnoser-client.tsx"), "utf8");
    expect(wiring).toMatch(/title="Wiring check"/);
    expect(wiring).toMatch(/feature="Wiring check"/);
    expect(wiring).toMatch(/Opening Wiring check/);
    const reuse = readFileSync(join(WEB, "app/reuse-advisor/reuse-advisor-client.tsx"), "utf8");
    expect(reuse).toMatch(/title="Reuse"/);
    expect(reuse).toMatch(/feature="Reuse"/);
    const radar = readFileSync(join(WEB, "app/cad-change-radar/cad-change-radar-client.tsx"), "utf8");
    expect(radar).toMatch(/title="Change radar"/);
    expect(radar).toMatch(/feature="Change radar"/);
    const bus = readFileSync(join(WEB, "app/bus-factor/bus-factor-client.tsx"), "utf8");
    expect(bus).toMatch(/title="Bus factor"/);
    expect(bus).toMatch(/feature="Bus factor"/);
    const readiness = readFileSync(join(WEB, "app/readiness-score/readiness-score-client.tsx"), "utf8");
    expect(readiness).toMatch(/title="Readiness"/);
    expect(readiness).toMatch(/feature="Readiness"/);
    const media = readFileSync(join(WEB, "app/media-kit/media-kit-client.tsx"), "utf8");
    expect(media).toMatch(/title="Media kit"/);
    expect(media).toMatch(/feature="Media kit"/);
  });
});
