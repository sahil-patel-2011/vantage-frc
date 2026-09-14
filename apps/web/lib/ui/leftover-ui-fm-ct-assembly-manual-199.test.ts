import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..", "..", "..");

describe("leftover Feature map Assembly manual choose team student copy", () => {
  it("uses student chrome", () => {
    const src = readFileSync(join(ROOT, "docs/FEATURE_MAP.md"), "utf8");
    expect(src).toContain("A shop Pi turns an Onshape assembly into a step book. Status is Waiting / Building the book / Ready — not queued/running. Every unsupported line prints \"confirm — not specified in CAD\"; a failed render is a labelled placeholder. Setup badge is **Needs setup**. No-team primary is **Choose your team**.");
  });
});
