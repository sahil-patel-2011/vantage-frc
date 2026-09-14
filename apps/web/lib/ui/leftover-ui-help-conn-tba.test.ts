import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

describe("leftover Help connectors setup student copy", () => {
  it("uses student chrome", () => {
    const src = readFileSync(join(WEB, "lib/help/articles.ts"), "utf8");
    expect(src).not.toContain("The Blue Alliance is configured under Team");
    expect(src).toContain("Team Data is configured under Team");
  });
});
