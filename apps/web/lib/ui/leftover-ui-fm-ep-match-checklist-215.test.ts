import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..", "..", "..");

describe("leftover Feature map Match checklist empty primary student copy", () => {
  it("uses student chrome", () => {
    const src = readFileSync(join(ROOT, "docs/FEATURE_MAP.md"), "utf8");
    expect(src).toContain("Timed pit runs plus **hang the correct bumpers** from alliance lists, **SB50 lock / battery strap**, **DS laptop** (charging / never sleep, ethernet seated, Game Bar off), **vision lens wipe**, **bolt check**, **Kraken power screws**, and **tape accidental controller buttons** — older stored runs stay complete; empty/setup + next actions. Last snapshot stays on this phone (`if (!view)`). Setup badge is **Needs setup**. No-team primary is **Choose your team**. Empty keeps one primary.");
  });
});
