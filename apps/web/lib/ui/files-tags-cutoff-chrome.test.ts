import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

/**
 * Leftover student chrome not skip-list and not in open PRs #2–#40:
 * Files layout toggle, Drive-team tags next actions, usage-cutoff banner,
 * share-link control, Account profile, Help search, and phone-code setup
 * still used native app-button / OTP / Pairwise 2.0 / Hard cut-off copy.
 */
const FILES = [
  "app/files/files-client.tsx",
  "app/team-tags/team-tags-client.tsx",
  "components/usage-cutoff-banner.tsx",
  "components/copy-share-link.tsx",
  "app/account/account-profile-panel.tsx",
  "app/help/help-client.tsx",
  "lib/account/phone-otp.ts",
] as const;

describe("leftover Files / tags / cutoff student chrome", () => {
  it("uses Button and student copy instead of leftover native app-button and jargon", () => {
    for (const rel of FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/className=["'`][^"']*app-button/);
      expect(src, rel).not.toMatch(/className=\{[^}]*app-button/);
      expect(src, rel).not.toMatch(/Pairwise 2\.0/);
      expect(src, rel).not.toMatch(/Hard cut-off/);
      expect(src, rel).not.toMatch(/subscription bridge/i);
      expect(src, rel).not.toMatch(/setup-required until Twilio/i);
      expect(src, rel).not.toMatch(/HTTP \$\{response\.status\}/);
    }
  });

  it("phone setup copy never names Twilio or env vars", () => {
    const src = readFileSync(join(WEB, "lib/account/phone-otp.ts"), "utf8");
    expect(src).toMatch(/Phone codes need text messaging set up on this team/);
    expect(src).not.toMatch(/Phone OTP send needs TWILIO_/);
    expect(src).not.toMatch(/Twilio SMS is configured/);
  });
});
