import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

describe("leftover District TBA sync student copy", () => {
  it("uses student chrome", () => {
    const src = readFileSync(join(WEB, "lib/district-trajectory-sim/compute-district-trajectory-sim.ts"), "utf8");
    expect(src).not.toContain("TBA/Statbotics sync hasn't picked it up.");
    expect(src).toContain("Team Data sync has not picked it up.");
  });
});
