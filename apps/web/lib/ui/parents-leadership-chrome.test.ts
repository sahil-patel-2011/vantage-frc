import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  LEADERSHIP_RELATED_INCLUDE,
  leadershipNextActions,
  leadershipRelatedLinks,
  leadershipShellCopy,
  shouldShowLeadershipSummaryTiles,
} from "../leadership/leadership-related";
import {
  PARENTS_RELATED_INCLUDE,
  parentsNextActions,
  parentsRelatedLinks,
  parentsShellCopy,
} from "../parents/parents-related";
import { expectPlainCopy } from "./copy-assertions";

const WEB = join(__dirname, "..", "..");

/**
 * Parent updates still said Setup required and nested Calendar/Forms in
 * Next-actions. Leadership empty painted 0% succession tiles, Setup required,
 * and a Next-actions wall beside the add-role form. Both now Needs setup, one
 * primary, related in the header, Next-actions only on ready.
 */
const FILES = [
  "app/parents/parents-client.tsx",
  "lib/parents/parents-related.ts",
  "app/api/parents/route.ts",
  "app/leadership/leadership-client.tsx",
  "lib/leadership/leadership-related.ts",
  "lib/leadership/compute-leadership.ts",
  "app/api/leadership/route.ts",
] as const;

describe("Parents / Leadership student chrome", () => {
  it("does not print leftover Setup required or database-access copy", () => {
    for (const rel of FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/Setup required/);
      expect(src, rel).not.toMatch(/confirm database access/i);
      expect(src, rel).not.toMatch(/className="primary-action"/);
    }
  });

  it("setup badges and related copy stay student-readable", () => {
    expect(parentsShellCopy("setup").badge).toBe("Needs setup");
    expect(leadershipShellCopy("setup").badge).toBe("Needs setup");
    expectPlainCopy(parentsShellCopy("setup").description);
    expectPlainCopy(leadershipShellCopy("setup").description);
    expect(parentsRelatedLinks("org-1", { include: [...PARENTS_RELATED_INCLUDE] }).map((l) => l.label)).toEqual([
      "Calendar",
      "People",
      "Forms",
    ]);
    expect(leadershipRelatedLinks("org-1", { include: [...LEADERSHIP_RELATED_INCLUDE] }).map((l) => l.label)).toEqual([
      "Season roles",
      "Skills",
      "Safety",
    ]);
  });

  it("Next-actions stay off empty; restricted opens Home; tiles stay off until a role exists", () => {
    expect(parentsNextActions({ orgId: "org-1", shell: "empty" })).toEqual([]);
    expect(leadershipNextActions({ orgId: "org-1", shell: "empty" })).toEqual([]);
    expect(parentsNextActions({ orgId: "org-1", shell: "restricted" })[0]?.label).toBe("Open Home");
    expect(shouldShowLeadershipSummaryTiles(0)).toBe(false);
  });
});

describe("Parents / Leadership keep one primary on empty/setup", () => {
  it("Parent updates empty/setup keep Choose your team or the add-contact form as the only CTA", () => {
    const src = readFileSync(join(WEB, "app/parents/parents-client.tsx"), "utf8");
    expect(src).toMatch(/Needs setup/);
    expect(src).toMatch(/shell === "ready"/);
    expect(src).toMatch(/id="parent-contact"/);
    expect(src).not.toMatch(/ParentsNextActions/);
  });

  it("Leadership empty hides succession tiles and the Next-actions wall", () => {
    const src = readFileSync(join(WEB, "app/leadership/leadership-client.tsx"), "utf8");
    expect(src).toMatch(/Needs setup/);
    expect(src).toMatch(/shouldShowLeadershipSummaryTiles/);
    expect(src).toMatch(/shell === "ready"/);
    expect(src).not.toMatch(/LeadershipNextActions/);
  });
});
