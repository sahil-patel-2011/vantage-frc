import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

/**
 * Leftover student EmptyState title="Loading…" boards after leftover
 * opening-fmea. Hub labels stay Season roles, Knowledge drafts, Budget
 * check, and Schema sync. leftover-opening-fmea Opening Failure log,
 * leftover-opening-path Opening Recognition, leftover-opening-wire
 * Opening Auto routines, leftover-opening-build Opening Bring-up,
 * leftover-opening-calc Opening Gearbox calculator, leftover-pick-before
 * Choose your team, leftover-fmea Failure log stay. leftover-admin
 * skip-list Global Team Manager stays. leftover-my-day Loading My Day
 * stays (hub My Day). Hub Schema A/B stays. leftover-types comments in
 * lib/roles/types.ts stay. leftover-offline extras and leftover-hub extras
 * stay off these FILES. leftover-hub-mismatch Training vs Scout training
 * mode stays off this family. Routes stay. Do not invent a last-snapshot.
 */
const FILES = [
  "app/roles/roles-client.tsx",
  "app/knowledge-drafts/knowledge-drafts-client.tsx",
  "app/budget-reconciler/budget-reconciler-client.tsx",
  "app/scout-schema-negotiate/scout-schema-negotiate-client.tsx",
] as const;

describe("leftover student opening-roles chrome", () => {
  it("does not print leftover EmptyState Loading titles", () => {
    for (const rel of FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/title="Loading/);
      expect(src, rel).not.toMatch(/title: "Loading/);
      expect(src, rel).not.toMatch(/Roles & Responsibilities/);
    }
    const roles = readFileSync(join(WEB, "app/roles/roles-client.tsx"), "utf8");
    expect(roles).toMatch(/Opening Season roles/);
    expect(roles).toMatch(/title="Season roles"/);
    expect(roles).toMatch(/feature="Season roles"/);
    const drafts = readFileSync(
      join(WEB, "app/knowledge-drafts/knowledge-drafts-client.tsx"),
      "utf8",
    );
    expect(drafts).toMatch(/Opening Knowledge drafts/);
    expect(drafts).toMatch(/title="Knowledge drafts"/);
    expect(drafts).toMatch(/feature="Knowledge drafts"/);
    const check = readFileSync(
      join(WEB, "app/budget-reconciler/budget-reconciler-client.tsx"),
      "utf8",
    );
    expect(check).toMatch(/Opening Budget check/);
    expect(check).toMatch(/title="Budget check"/);
    expect(check).toMatch(/feature="Budget check"/);
    const schema = readFileSync(
      join(WEB, "app/scout-schema-negotiate/scout-schema-negotiate-client.tsx"),
      "utf8",
    );
    expect(schema).toMatch(/Opening Schema sync/);
    expect(schema).toMatch(/title="Schema sync"/);
    expect(schema).toMatch(/feature="Schema sync"/);
  });
});
