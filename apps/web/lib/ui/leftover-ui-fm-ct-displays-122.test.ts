import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..", "..", "..");

describe("leftover Feature map Displays choose team student copy", () => {
  it("uses student chrome", () => {
    const src = readFileSync(join(ROOT, "docs/FEATURE_MAP.md"), "utf8");
    expect(src).toContain("Pit TV + kiosk; PitFUSION-style queue (leave pit at 15m, **red QUEUE SOON under 5m** from official match time) + bumper color from alliance lists; prediction widgets stay blank until real rows Setup badge is **Needs setup**. No-team primary is **Choose your team**.");
  });
});
