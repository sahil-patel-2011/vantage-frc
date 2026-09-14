import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..", "..", "..");

describe("leftover Feature map Vantage Drive empty primary student copy", () => {
  it("uses student chrome", () => {
    const src = readFileSync(join(ROOT, "docs/FEATURE_MAP.md"), "utf8");
    expect(src).toContain("My files, Team files, Shared with me, Recent, Bin. **Keep on this device** stores the bytes in IndexedDB (200 MB cap) so a file still opens in the stands. Assembly manuals keep their PDF the same way once a run finishes. Student copy says **hosted storage** / **storage node**, not object storage. Setup empty keeps one **Choose your team** primary. Setup badge is **Needs setup**. Empty keeps one primary.");
  });
});
