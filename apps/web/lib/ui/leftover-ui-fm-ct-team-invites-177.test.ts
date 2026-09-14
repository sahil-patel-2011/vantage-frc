import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..", "..", "..");

describe("leftover Feature map Team invites choose team student copy", () => {
  it("uses student chrome", () => {
    const src = readFileSync(join(ROOT, "docs/FEATURE_MAP.md"), "utf8");
    expect(src).toContain("Exact-email only. Create/resend commits first then emails; admin always gets a one-time copyable `/invite?token=` link. Local/unconfigured email is honest (copy link). People without an invite go to the waitlist. `/invite` is public preview; accept still requires the invited session. Setup badge is **Needs setup**. No-team primary is **Choose your team**.");
  });
});
