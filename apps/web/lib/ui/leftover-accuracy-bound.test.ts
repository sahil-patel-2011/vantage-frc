import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

describe("leftover Scout Accuracy student copy", () => {
  it("uses student chrome", () => {
    const src = readFileSync(join(WEB, "lib/scout-accuracy/scout-accuracy-related.ts"), "utf8");
    expect(src).not.toMatch(/membership-bound/);
    expect(src).toMatch(/signed-in scout/);
  });
});
