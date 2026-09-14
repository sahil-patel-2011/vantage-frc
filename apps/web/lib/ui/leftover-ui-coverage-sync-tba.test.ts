import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

describe("leftover Coverage sync student copy", () => {
  it("uses student chrome", () => {
    const src = readFileSync(join(WEB, "lib/scout-coverage-live/compute-scout-coverage-live.ts"), "utf8");
    expect(src).not.toContain("wait for the schedule to sync from TBA");
    expect(src).toContain("wait for the schedule to sync from Team Data");
  });
});
