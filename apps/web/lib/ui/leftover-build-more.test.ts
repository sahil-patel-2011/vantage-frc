import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

/**
 * Leftover student Parts Relay / Subsystem Sign-off titles after
 * leftover-invites. Hub has no Parts Relay / Subsystem Sign-off tabs.
 * Gold is sentence-case Parts relay / Subsystem sign-off. leftover-fmea
 * Failure log, leftover-fmea-strips no Open FMEA, leftover-pick Choose
 * your team, leftover-invites Invites, leftover-visit-invites Visit
 * invites, leftover-community-impact Impact, leftover-event-day-more
 * Event day, leftover-ops-more Skills / Risk register / Burndown stay.
 * Routes stay. Do not invent a last-snapshot.
 */
const FILES = [
  "app/parts-relay/parts-relay-client.tsx",
  "app/parts-relay/page.tsx",
  "app/api/parts-relay/route.ts",
  "lib/offline/shell-routes.ts",
  "app/subsystem-signoff/subsystem-signoff-client.tsx",
  "app/subsystem-signoff/page.tsx",
  "lib/subsystem-signoff/subsystem-signoff-related.ts",
  "app/api/readiness-score/route.ts",
  "lib/manifests/parts-relay.manifest.ts",
  "lib/manifests/subsystem-signoff.manifest.ts",
] as const;

describe("leftover student build-more chrome", () => {
  it("does not print leftover Parts Relay / Subsystem Sign-off titles", () => {
    for (const rel of FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/Parts Relay/);
      expect(src, rel).not.toMatch(/Subsystem Sign-off/);
    }
    const parts = readFileSync(join(WEB, "app/parts-relay/parts-relay-client.tsx"), "utf8");
    expect(parts).toMatch(/title="Parts relay"/);
    expect(parts).toMatch(/feature="Parts relay"/);
    expect(parts).toMatch(/Opening Parts relay/);
    expect(parts).not.toMatch(/title="Loading/);
    const signoff = readFileSync(
      join(WEB, "app/subsystem-signoff/subsystem-signoff-client.tsx"),
      "utf8",
    );
    expect(signoff).toMatch(/title="Subsystem sign-off"/);
    expect(signoff).toMatch(/feature="Subsystem sign-off"/);
    expect(signoff).toMatch(/Opening Subsystem sign-off/);
    expect(signoff).not.toMatch(/title="Loading/);
    expect(signoff).toMatch(/Failure log/);
    expect(signoff).not.toMatch(/Open FMEA/);
    expect(signoff).not.toMatch(/label: "FMEA"/);
    expect(signoff).not.toMatch(/Scan FMEA/);
    expect(signoff).not.toMatch(/Log FMEA/);
    expect(signoff).not.toMatch(/FMEA failure\(s\)/);
    expect(signoff).not.toMatch(/prior FMEA/);
    expect(signoff).not.toMatch(/>FMEA</);
    expect(signoff).not.toMatch(/FMEA →/);
    const related = readFileSync(
      join(WEB, "lib/subsystem-signoff/subsystem-signoff-related.ts"),
      "utf8",
    );
    expect(related).toMatch(/Failure log/);
    expect(related).toMatch(/Scan open Failure log/);
    expect(related).toMatch(/Log failures in Failure log/);
    expect(related).toMatch(/Choose your team/);
    expect(related).not.toMatch(/\bPick a team\b/);
    expect(related).not.toMatch(/Join or pick a team/);
    expect(related).not.toMatch(/Open FMEA/);
    expect(related).not.toMatch(/label: "FMEA"/);
    expect(related).not.toMatch(/Scan FMEA/);
    expect(related).not.toMatch(/Log FMEA/);
    expect(related).not.toMatch(/FMEA failure\(s\)/);
    expect(related).not.toMatch(/prior FMEA/);
    expect(related).not.toMatch(/>FMEA</);
    expect(related).not.toMatch(/FMEA →/);
    const routes = readFileSync(join(WEB, "lib/offline/shell-routes.ts"), "utf8");
    expect(routes).toMatch(/if \(bare\.startsWith\("\/parts-relay"\)\) return "Parts relay"/);
    expect(routes).toMatch(
      /if \(bare\.startsWith\("\/subsystem-signoff"\)\) return "Subsystem sign-off"/,
    );
    expect(routes).toMatch(/if \(bare\.startsWith\("\/team\/admin"\)\) return "Invites"/);
    expect(routes).toMatch(
      /if \(bare\.startsWith\("\/visit-invites"\)\) return "Visit invites"/,
    );
    expect(routes).toMatch(/if \(bare\.startsWith\("\/impact"\)\) return "Impact"/);
    expect(routes).toMatch(/if \(bare\.startsWith\("\/command"\)\) return "Event day"/);
    expect(routes).toMatch(/if \(bare\.startsWith\("\/skills-graph"\)\) return "Skills"/);
    expect(routes).toMatch(/if \(bare\.startsWith\("\/risks"\)\) return "Risk register"/);
    expect(routes).toMatch(/if \(bare\.startsWith\("\/build-burndown"\)\) return "Burndown"/);
    expect(routes).toMatch(/if \(bare\.startsWith\("\/fmea"\)\) return "Failure log"/);
  });
});
