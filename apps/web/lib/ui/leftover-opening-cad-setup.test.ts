import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

/**
 * Leftover student EmptyState title="Loading…" boards after leftover
 * opening-rank. Hub / leftover-offline labels stay CAD setup,
 * Prototypes, Tuning log, and Code vs match. leftover-cad extras,
 * leftover-cad-titles Prototypes extras, leftover-fmea-strips extras,
 * leftover-lxi-pid extras, leftover-code-coach extras stay.
 * leftover-opening-rank Opening Rank projection, leftover-opening-debrief
 * Opening Kickoff, leftover-pick-before Choose your team, leftover-fmea
 * Failure log stay. leftover-admin skip-list Global Team Manager stays.
 * leftover-my-day Loading My Day stays (hub My Day). Hub Schema A/B
 * stays. leftover-offline extras and leftover-hub extras stay off these
 * FILES. leftover-safety Safety incidents stays. Routes stay. Do not
 * invent a last-snapshot.
 */
const FILES = [
  "app/cad/setup/setup-client.tsx",
  "app/prototype-tracker/prototype-tracker-client.tsx",
  "app/tuning/tuning-client.tsx",
  "app/code-perf/code-perf-client.tsx",
] as const;

describe("leftover student opening-cad-setup chrome", () => {
  it("does not print leftover EmptyState Loading titles", () => {
    for (const rel of FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/title="Loading/);
      expect(src, rel).not.toMatch(/title: "Loading/);
      expect(src, rel).not.toMatch(/Prototype-to-Decision Tracker/);
      expect(src, rel).not.toMatch(/Code Coach/);
    }
    const setup = readFileSync(join(WEB, "app/cad/setup/setup-client.tsx"), "utf8");
    expect(setup).toMatch(/Opening CAD setup/);
    expect(setup).toMatch(/CAD_SETUP_TITLE/);
    expect(setup).toMatch(/feature="CAD setup"/);
    const proto = readFileSync(
      join(WEB, "app/prototype-tracker/prototype-tracker-client.tsx"),
      "utf8",
    );
    expect(proto).toMatch(/Opening Prototypes/);
    expect(proto).toMatch(/title="Prototypes"/);
    expect(proto).toMatch(/feature="Prototypes"/);
    const tuning = readFileSync(join(WEB, "app/tuning/tuning-client.tsx"), "utf8");
    expect(tuning).toMatch(/Opening Tuning log/);
    expect(tuning).toMatch(/title="Tuning log"/);
    expect(tuning).toMatch(/feature="Tuning log"/);
    const perf = readFileSync(join(WEB, "app/code-perf/code-perf-client.tsx"), "utf8");
    expect(perf).toMatch(/Opening Code vs match/);
    expect(perf).toMatch(/title="Code vs match"/);
    expect(perf).toMatch(/feature="Code vs match"/);
  });
});
