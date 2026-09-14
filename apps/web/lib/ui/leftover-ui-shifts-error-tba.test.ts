import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

describe("leftover Shift balancer error student copy", () => {
  it("uses student chrome", () => {
    const src = readFileSync(join(WEB, "lib/shift-balancer/compute-shift-balancer.ts"), "utf8");
    expect(src).not.toContain("Sync TBA or pick an event on Command.");
    expect(src).toContain("Sync Team Data or pick an event on Event day.");
  });
});
