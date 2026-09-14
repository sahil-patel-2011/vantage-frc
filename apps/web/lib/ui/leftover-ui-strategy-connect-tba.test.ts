import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

describe("leftover Strategy connect student copy", () => {
  it("uses student chrome", () => {
    const src = readFileSync(join(WEB, "app/api/strategy/route.ts"), "utf8");
    expect(src).not.toContain("Connect The Blue Alliance under Team");
    expect(src).toContain("Sync Team Data under Team");
  });
});
