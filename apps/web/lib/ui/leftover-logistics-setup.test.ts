import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

describe("leftover Logistics student copy", () => {
  it("uses student chrome", () => {
    const src = readFileSync(join(WEB, "lib/logistics/logistics-related.ts"), "utf8");
    expect(src).not.toMatch(/Finish setup for travel plans/);
    expect(src).toMatch(/title: "Choose your team"/);
  });
});
