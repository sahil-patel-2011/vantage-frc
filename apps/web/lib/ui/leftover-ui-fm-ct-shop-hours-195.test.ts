import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..", "..", "..");

describe("leftover Feature map Shop hours choose team student copy", () => {
  it("uses student chrome", () => {
    const src = readFileSync(join(ROOT, "docs/FEATURE_MAP.md"), "utf8");
    expect(src).toContain("Clock in/out, kiosk scans, and last-snapshot when the shop Wi-Fi dies (`if (!view)` — a failed refresh keeps the painted board). Queued clock events upload when you are back online. Setup badge is **Needs setup**. No-team primary is **Choose your team**.");
  });
});
