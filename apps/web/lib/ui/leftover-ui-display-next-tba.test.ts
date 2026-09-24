import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

describe("leftover Display next match student copy", () => {
  it("uses student chrome", () => {
    const src = readFileSync(join(WEB, "lib/display.ts"), "utf8");
    expect(src).not.toContain("and leave-now status from TBA");
    // Plain preset copy (walk 4, drive coach): what the pit crew sees, not where it comes from.
    expect(src).toContain("Countdown to queue, bumper colour, and who we play with and against");
  });
});
