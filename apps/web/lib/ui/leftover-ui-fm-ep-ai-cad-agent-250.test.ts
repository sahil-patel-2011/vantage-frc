import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..", "..", "..");

describe("leftover Feature map AI CAD agent empty primary student copy", () => {
  it("uses student chrome", () => {
    const src = readFileSync(join(ROOT, "docs/FEATURE_MAP.md"), "utf8");
    expect(src).toContain("Claude-CodeCad loop in the hub: paste or bind an Onshape URL → **Edit in Onshape** (official embed or deep link) plus chat brief → live `onshape_sketch_rectangle` / `onshape_extrude` (`feature=cad`). Viewport empty says **Connect Onshape** / **No picture yet** with **Needs setup**, not shaded-view PNG. No mock job planner. Fusion human-edit is paste-link **Edit in Fusion** on setup, vault, and connections — not the Onshape viewport. Setup badge is **Needs setup**. No-team primary is **Choose your team**. Empty keeps one primary.");
  });
});
