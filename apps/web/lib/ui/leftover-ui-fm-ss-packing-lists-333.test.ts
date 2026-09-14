import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..", "..", "..");

describe("leftover Feature map Packing lists setup wording student copy", () => {
  it("uses student chrome", () => {
    const src = readFileSync(join(ROOT, "docs/FEATURE_MAP.md"), "utf8");
    expect(src).toContain("Competition load-out checklists. Empty/setup one primary (**Choose your team** / **Create competition load-out**). Last snapshot stays on screen (`if (!view)`); packed ticks and requests queue and send on reconnect. Setup badge is **Needs setup**. Empty keeps one primary. Student chrome says **Needs setup**, not Setup.");
  });
});
