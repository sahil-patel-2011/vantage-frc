import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

describe("leftover Visit invites student copy", () => {
  it("uses student chrome", () => {
    const src = readFileSync(join(WEB, "lib/visit-invites/visit-related.ts"), "utf8");
    expect(src).not.toMatch(/Finish setup for visit invites/);
    expect(src).toMatch(/title: "Choose your team"/);
  });
});
