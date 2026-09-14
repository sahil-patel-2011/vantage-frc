import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..", "..", "..");

describe("leftover Feature map CAD setup needs setup student copy", () => {
  it("uses student chrome", () => {
    const src = readFileSync(join(ROOT, "docs/FEATURE_MAP.md"), "utf8");
    expect(src).toContain("Student wizard: paste an Onshape document and **Edit in Onshape**, or paste a Fusion share link and **Edit in Fusion** (link-first; no OAuth / env names). Connect Onshape in the browser or Fusion on this computer. Ask a mentor when Onshape or Fusion is not ready — **Needs setup**, never a crash. Last IndexedDB copy (`feature: \"cad-setup\"`) stays on the phone (`if (!view)`). Pair desktop (`/cad/pair`) heading is **Pair this computer**. No-org / 401/403 is **Choose your team**. Setup badge is **Needs setup**.");
  });
});
