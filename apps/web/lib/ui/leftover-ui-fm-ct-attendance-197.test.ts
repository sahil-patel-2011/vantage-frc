import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..", "..", "..");

describe("leftover Feature map Attendance choose team student copy", () => {
  it("uses student chrome", () => {
    const src = readFileSync(join(ROOT, "docs/FEATURE_MAP.md"), "utf8");
    expect(src).toContain("Roll-call events and attendees. Setup badge is **Needs setup**. A failed refresh is **Unavailable**, not Setup — a network miss is not a Vantage gap. Last snapshot stays on this phone. No-team primary is **Choose your team**.");
  });
});
