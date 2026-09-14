import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

/**
 * Leftover student EmptyState title="Loading…" boards after leftover
 * opening-funding. leftover-invites no Team admin, leftover-help-workspace
 * no TBA, leftover-student-buttons no Setup required, leftover-opening
 * funding Opening Connectors, leftover-opening-inbox Opening Chat,
 * leftover-fmea Failure log, leftover-pick-before Choose your team stay.
 * Hub My Day / Schema A/B stay. Routes stay. Do not invent a last-snapshot.
 */
const FILES = [
  "app/account/account-client.tsx",
  "app/messages/chat-safety-panel.tsx",
] as const;

describe("leftover student opening-account chrome", () => {
  it("does not print leftover EmptyState Loading titles", () => {
    for (const rel of FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/title="Loading…"/);
      expect(src, rel).not.toMatch(/title="Loading /);
      expect(src, rel).not.toMatch(/Team admin/);
      expect(src, rel).not.toMatch(/Setup required/);
      expect(src, rel).not.toMatch(/primary-action/);
      expect(src, rel).not.toMatch(/\bTBA\b/);
    }
    const account = readFileSync(join(WEB, "app/account/account-client.tsx"), "utf8");
    expect(account).toMatch(/Opening Account/);
    expect(account).toMatch(/feature="Account"/);
    const safety = readFileSync(join(WEB, "app/messages/chat-safety-panel.tsx"), "utf8");
    expect(safety).toMatch(/Opening Chat safety/);
  });
});
