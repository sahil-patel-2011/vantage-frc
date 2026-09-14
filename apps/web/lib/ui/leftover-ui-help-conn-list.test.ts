import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

describe("leftover Help connectors list student copy", () => {
  it("uses student chrome", () => {
    const src = readFileSync(join(WEB, "lib/help/articles.ts"), "utf8");
    expect(src).not.toContain("GitHub, The Blue Alliance, Onshape");
    expect(src).toContain("GitHub, Team Data, Onshape");
  });
});
