import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..", "..", "..");

describe("leftover Feature map Account profile needs setup student copy", () => {
  it("uses student chrome", () => {
    const src = readFileSync(join(ROOT, "docs/FEATURE_MAP.md"), "utf8");
    expect(src).toContain("Display + legal name, DOB, recovery email, phone OTP (Twilio setup_required until env); notification prefs including team chat. Inbox tab badge is **Needs setup**. Save uses `Button`. Setup badge is **Needs setup**.");
  });
});
