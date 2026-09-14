import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

describe("leftover Rankings sync student copy", () => {
  it("uses student chrome", () => {
    const src = readFileSync(join(WEB, "lib/rankings/tba-cache.ts"), "utf8");
    expect(src).not.toContain("Sync TBA/Statbotics under Team");
    expect(src).toContain("Sync Team Data under Team");
  });
});
