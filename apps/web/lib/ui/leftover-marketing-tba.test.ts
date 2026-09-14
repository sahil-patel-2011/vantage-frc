import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { classifyDbError } from "../db-error";
import { teamDataNextActions } from "../team-data/team-data-related";
import { expectPlainCopy } from "./copy-assertions";

const WEB = join(__dirname, "..", "..");

/**
 * Leftover public / Team Data related / picklist / health chrome after the
 * related-strip TBA pass. Connect TBA and Save a TBA key stay on Team Data.
 * Do not invent a last-snapshot.
 */
const STRICT_FILES = [
  "components/marketing/product-demos.tsx",
  "components/seo/structured-data.tsx",
  "lib/marketing/seo.ts",
  "lib/db-error.ts",
  "lib/reference-health.ts",
  "lib/scout-training-mode/compute-scout-training-mode.ts",
  "lib/picklist/store.ts",
] as const;

describe("leftover marketing / health / picklist TBA chrome", () => {
  it("does not print TBA, Statbotics, or The Blue Alliance on this family", () => {
    for (const rel of STRICT_FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/TBA\/Statbotics/);
      expect(src, rel).not.toMatch(/\bTBA\b/);
      expect(src, rel).not.toMatch(/Statbotics/);
      expect(src, rel).not.toMatch(/The Blue Alliance/);
      expect(src, rel).not.toMatch(/Season EPA/);
      expect(src, rel).not.toMatch(/Sync TBA/);
    }
  });

  it("Team Data related details drop The Blue Alliance and keep Save a TBA key", () => {
    const src = readFileSync(join(WEB, "lib/team-data/team-data-related.ts"), "utf8");
    expect(src).not.toMatch(/The Blue Alliance/);
    expect(src).not.toMatch(/Statbotics/);
    expect(src).not.toMatch(/TBA\/Statbotics/);
    expect(src).not.toMatch(/Season EPA/);
    expect(src).not.toMatch(/Sync TBA/);
    expect(src).toMatch(/Save a TBA key/);
  });

  it("student DB errors and Team Data setup stay readable", () => {
    const friendly = classifyDbError(
      Object.assign(new Error("fk"), {
        code: "23503",
        constraint: "pick_lists_event_key_fkey",
        table: "pick_lists",
      }),
    );
    expect(friendly?.message).toMatch(/official event/);
    expectPlainCopy(friendly!.message);
    const actions = teamDataNextActions({
      orgId: "org-1",
      shell: "setup",
      hasActiveEvent: true,
      tbaConfigured: false,
    });
    expect(actions[0]?.label).toBe("Save a TBA key");
    expectPlainCopy(actions[0]!.detail);
  });
});
