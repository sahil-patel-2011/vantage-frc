import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..", "..", "..");

describe("leftover Feature map This phone choose team student copy", () => {
  it("uses student chrome", () => {
    const src = readFileSync(join(ROOT, "docs/FEATURE_MAP.md"), "utf8");
    expect(src).toContain("Cold no-signal boot plus a page that shows whether Scouting is saved on this device. Last snapshots stay on Competition, Event Day, **My Day**, Schedule, Calendar, Files, Chat, Hours, Packing, Batteries, Pit, Match notes, and **Pick desk**. Writes queue on the device. Setup badge is **Needs setup**. No-team primary is **Choose your team**.");
  });
});
