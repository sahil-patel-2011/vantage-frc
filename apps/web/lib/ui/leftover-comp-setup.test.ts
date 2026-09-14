import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

describe("leftover Competition setup student copy", () => {
  it("uses student chrome", () => {
    const src = readFileSync(join(WEB, "lib/strategy/competition-related.ts"), "utf8");
    expect(src).not.toMatch(/Finish setup so this page/);
    expect(src).toMatch(/Choose your team so this page/);
  });
});
