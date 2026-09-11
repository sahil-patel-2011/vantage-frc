import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

/**
 * Leftover student chrome on surfaces that are not skip-list and not in
 * open PRs #2–#36. Audit / posture / exports / knowledge history still say
 * “pick the team first” on purpose until those skip-list pages are golded.
 */
const FILES = [
  "app/showcase/page.tsx",
  "app/team/prompts/page.tsx",
  "app/team/getting-started/page.tsx",
  "app/account/account-shell.tsx",
  "app/editor/pair/pair-client.tsx",
] as const;

describe("leftover student choose-your-team chrome", () => {
  it("does not say pick the team first, Organization / workspace, or No team selected", () => {
    for (const rel of FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/pick the team first/i);
      expect(src, rel).not.toMatch(/Organization \/ workspace/);
      expect(src, rel).not.toMatch(/No team selected/);
      expect(src, rel).not.toMatch(/Pick an active team/);
    }
  });
});
