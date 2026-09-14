/**
 * Source lock for leftover Ask AI setup that still said "pick a team first"
 * / "per org" and painted extra EmptyState buttons after PRs #2–#34.
 * Those PRs own last-snapshot gold, Join-or-pick (#34), and leftover
 * "Pick a team" titles (#4/#12/#33) — not redone here.
 * Multi-fetch Memory / policy / usage snapshots stay uncached.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB_ROOT = join(__dirname, "..", "..");

const COPY_FILES = [
  "lib/ai-memory/ai-memory-related.ts",
  "lib/billing/ai-budgets-related.ts",
  "app/team/ai-memory/ai-memory-client.tsx",
  "app/team/budgets/budget-client.tsx",
  "app/team/usage/usage-client.tsx",
  "lib/ai-governance/ai-governance-related.ts",
] as const;

const NO_ORG_PAGES = [
  "app/chat/page.tsx",
  "app/team/budgets/page.tsx",
  "app/team/usage/page.tsx",
] as const;

function emptyStateInner(src: string): string[] {
  const blocks: string[] = [];
  let from = 0;
  while (true) {
    const start = src.indexOf("<EmptyState", from);
    if (start < 0) break;
    const tagEnd = src.indexOf(">", start);
    if (tagEnd < 0) break;
    const close = src.indexOf("</EmptyState>", tagEnd);
    if (close < 0) break;
    blocks.push(src.slice(tagEnd + 1, close));
    from = close + 1;
  }
  return blocks;
}

describe("leftover Ask AI setup says Choose your team", () => {
  it("does not tell the reader to pick a team first or save per org", () => {
    for (const rel of COPY_FILES) {
      const src = readFileSync(join(WEB_ROOT, rel), "utf8");
      expect(src, rel).not.toMatch(/pick a team first/i);
      expect(src, rel).not.toMatch(/saved per org/);
      expect(src, rel).not.toMatch(/Team-shared \(org\)/);
    }
  });

  it("no-org empty cards keep one Choose your team primary", () => {
    for (const rel of NO_ORG_PAGES) {
      const src = readFileSync(join(WEB_ROOT, rel), "utf8");
      expect(src, rel).toMatch(/Choose your team/);
      expect(src, rel).not.toMatch(/Open Teams/);
      const inners = emptyStateInner(src);
      expect(inners.length, rel).toBeGreaterThan(0);
      for (const inner of inners) {
        const buttons = inner.match(/<Button\b/g) ?? [];
        expect(buttons, `${rel} EmptyState extra buttons`).toHaveLength(1);
        expect(inner).toMatch(/variant="primary"/);
        expect(inner).toMatch(/Choose your team/);
      }
    }
  });

  it("Chat limits chrome does not say API keys or Organization hard limits", () => {
    const src = readFileSync(join(WEB_ROOT, "app/team/budgets/budget-client.tsx"), "utf8");
    expect(src).not.toMatch(/>API keys</);
    expect(src).toMatch(/Team spend limits/);
    expect(src).not.toMatch(/Organization hard limits/);
  });
});
