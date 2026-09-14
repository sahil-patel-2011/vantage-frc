import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..", "..", "..");

describe("leftover Feature map Inbox empty primary student copy", () => {
  it("uses student chrome", () => {
    const src = readFileSync(join(ROOT, "docs/FEATURE_MAP.md"), "utf8");
    expect(src).toContain("Account inbox. Empty keeps one EmptyState primary (**Show all** on unread). Related in the header (**What’s new · Help & Support · Account · Preferences**). Next-actions stay off empty. Last snapshot (`feature: \"notifications\"` / `\"notification-prefs\"`) stays on the phone (`if (!view)`). 401/403 drops the painted board. Setup badge is **Needs setup**. No TBA / CRM / Resend / env names. No-team primary is **Choose your team**. Empty keeps one primary.");
  });
});
