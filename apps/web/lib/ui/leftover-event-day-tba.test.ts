import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

describe("leftover Event day plan student copy", () => {
  it("uses student chrome", () => {
    const src = readFileSync(join(WEB, "lib/event-day-plan/event-day-plan-related.ts"), "utf8");
    expect(src).not.toMatch(/The Blue Alliance/);
    expect(src).toMatch(/Team Data/);
  });
});
