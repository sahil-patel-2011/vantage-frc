import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

describe("leftover Vendor lead times student copy", () => {
  it("does not tell the reader to Pick a team", () => {
    const src = readFileSync(join(WEB, "lib/vendor-lead-times/vendor-lead-times-related.ts"), "utf8");
    expect(src).not.toMatch(/\bPick a team\b/);
    expect(src).toMatch(/Choose your team/);
  });
});
