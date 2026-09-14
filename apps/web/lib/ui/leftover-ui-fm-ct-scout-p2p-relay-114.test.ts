import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..", "..", "..");

describe("leftover Feature map Scout P2P Relay choose team student copy", () => {
  it("uses student chrome", () => {
    const src = readFileSync(join(ROOT, "docs/FEATURE_MAP.md"), "utf8");
    expect(src).toContain("BroadcastChannel pit mesh + paste envelopes merge IndexedDB outbox last-write-wins; captain uplink; QR handoff for other tablets Setup badge is **Needs setup**. No-team primary is **Choose your team**.");
  });
});
