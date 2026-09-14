import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..", "..", "..");

describe("leftover Feature map Sign-in choose team student copy", () => {
  it("uses student chrome", () => {
    const src = readFileSync(join(ROOT, "docs/FEATURE_MAP.md"), "utf8");
    expect(src).toContain("Google + numeric email OTP. Closed membership: uninvited Google/email → waitlist copy, not a stack trace. Setup badge is **Needs setup**. No env-var names, no deployment docs. No-team primary is **Choose your team**.");
  });
});
