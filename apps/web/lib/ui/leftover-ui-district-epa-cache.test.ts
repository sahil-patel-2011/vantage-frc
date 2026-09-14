import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

describe("leftover District EPA cache student copy", () => {
  it("uses student chrome", () => {
    const src = readFileSync(join(WEB, "lib/district-trajectory-sim/compute-district-trajectory-sim.ts"), "utf8");
    expect(src).not.toContain("Not enough cached EPA data yet for your team and district — sync TBA/Statbotics reference data first.");
    expect(src).toContain("Not enough cached rating data yet for your team and district — sync Team Data first.");
  });
});
