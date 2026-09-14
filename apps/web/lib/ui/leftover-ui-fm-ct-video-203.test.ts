import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..", "..", "..");

describe("leftover Feature map Video choose team student copy", () => {
  it("uses student chrome", () => {
    const src = readFileSync(join(ROOT, "docs/FEATURE_MAP.md"), "utf8");
    expect(src).toContain("Featured under Event day as **Match video**. Paste a match or pit video. Status is Waiting / Watching / Ready to confirm. **Analyze this video** is the live-org primary (paste submit only — empty EmptyState is copy). Results are a timestamped timeline. Confirm keeps it as video evidence — scouted numbers do not change. Related: **Event day · Match notes · Match video**. Next-actions only after a video is queued. `/video` stays Match video; its related strip is **Scouting · Event day**. Setup badge is **Needs setup**. No-team primary is **Choose your team**.");
  });
});
