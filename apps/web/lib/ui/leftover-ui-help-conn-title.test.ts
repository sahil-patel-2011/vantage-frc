import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

describe("leftover Help connectors title student copy", () => {
  it("uses student chrome", () => {
    const src = readFileSync(join(WEB, "lib/help/articles.ts"), "utf8");
    expect(src).not.toContain("Connect TBA, Onshape, GitHub, and chat");
    expect(src).toContain("Connect Team Data, Onshape, GitHub, and chat");
  });
});
