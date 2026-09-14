import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

describe("leftover Help Ask AI student copy", () => {
  it("uses student chrome", () => {
    const src = readFileSync(join(WEB, "lib/help/articles.ts"), "utf8");
    expect(src).not.toContain("plus The Blue Alliance and Statbotics;");
    expect(src).toContain("plus Team Data;");
  });
});
