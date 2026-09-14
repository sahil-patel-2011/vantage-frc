import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

describe("leftover Strategy sync label student copy", () => {
  it("uses student chrome", () => {
    const src = readFileSync(join(WEB, "app/api/strategy/route.ts"), "utf8");
    expect(src).not.toContain("label: \"Sync TBA\"");
    expect(src).toContain("label: \"Sync Team Data\"");
  });
});
