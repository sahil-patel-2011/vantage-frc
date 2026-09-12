import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { aiBudgetsShellCopy, aiUsageShellCopy, formatAiBudgetsMoney } from "../billing/ai-budgets-related";
import { mediaShellCopy } from "../media/media-related";
import { knowledgeGapShellCopy } from "../knowledge-gap/knowledge-gap-related";
import { scoutAccuracyShellCopy } from "../scout-accuracy/scout-accuracy-related";
import { offlineCapableLabel } from "../offline/shell-routes";
import { whatsNewNextActions } from "../whats-new";

const WEB = join(__dirname, "..", "..");

/**
 * Leftover-product student chrome: billing/credits, Files/media, Help / What’s new,
 * print farm, Playbook, Inspection, and remaining scout boards. Stayed off
 * remaining-boards-2, Hours, relays, and code-vs-match.
 */
const FILES = [
  "lib/billing/ai-budgets-related.ts",
  "app/team/budgets/page.tsx",
  "app/team/budgets/budget-client.tsx",
  "app/team/usage/page.tsx",
  "app/team/usage/usage-client.tsx",
  "app/team/ai-usage/ai-usage-client.tsx",
  "app/files/files-client.tsx",
  "app/files/files-panels.tsx",
  "lib/media/media-related.ts",
  "app/media/media-client.tsx",
  "lib/media-kit/media-kit-related.ts",
  "app/media-kit/media-kit-client.tsx",
  "app/help/help-client.tsx",
  "lib/whats-new/whats-new-related.ts",
  "app/whats-new/whats-new-client.tsx",
  "app/print-farm/print-farm-chrome.tsx",
  "app/print-farm/print-farm-client.tsx",
  "app/team/knowledge/knowledge-client.tsx",
  "app/inspection/inspection-client.tsx",
  "lib/inspection-copilot/inspection-copilot-related.ts",
  "lib/scout-accuracy/scout-accuracy-related.ts",
] as const;

function emptyStates(src: string): { tag: string; inner: string }[] {
  const blocks: { tag: string; inner: string }[] = [];
  let from = 0;
  while (true) {
    const start = src.indexOf("<EmptyState", from);
    if (start < 0) break;
    const tagEnd = src.indexOf(">", start);
    if (tagEnd < 0) break;
    const close = src.indexOf("</EmptyState>", tagEnd);
    if (close < 0) break;
    blocks.push({ tag: src.slice(start, tagEnd + 1), inner: src.slice(tagEnd + 1, close) });
    from = close + 1;
  }
  return blocks;
}

describe("leftover-product student chrome", () => {
  it("does not print Setup required, Hard cut-off, or VANTAGE on this slice", () => {
    for (const rel of FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/Setup required/);
      expect(src, rel).not.toMatch(/Hard cut-off/);
      expect(src, rel).not.toMatch(/VANTAGE \//);
      expect(src, rel).not.toMatch(/Hosted by Vantage/);
      expect(src, rel).not.toMatch(/primary-action/);
      expect(src, rel).not.toMatch(/fetchFailed \|\| !view/);
    }
  });

  it("setup is Needs setup; balances stay blank until a ledger exists", () => {
    expect(aiBudgetsShellCopy("setup").badge).toBe("Needs setup");
    expect(aiUsageShellCopy("setup").badge).toBe("Needs setup");
    expect(mediaShellCopy("setup").badge).toBe("Needs setup");
    expect(knowledgeGapShellCopy("setup").badge).toBe("Needs setup");
    expect(scoutAccuracyShellCopy("setup").badge).toBe("Needs setup");
    expect(formatAiBudgetsMoney(null, true)).toBe("—");
    expect(formatAiBudgetsMoney(0, true)).toBe("$0.00");
    expect(whatsNewNextActions({ releaseCount: 0 })).toEqual([]);

    const budgetsPage = readFileSync(join(WEB, "app/team/budgets/page.tsx"), "utf8");
    const usagePage = readFileSync(join(WEB, "app/team/usage/page.tsx"), "utf8");
    for (const src of [budgetsPage, usagePage]) {
      const setupCards = emptyStates(src).filter((block) => /Needs setup/.test(`${block.tag}${block.inner}`));
      expect(setupCards.length).toBeGreaterThan(0);
      for (const card of setupCards) {
        expect(card.inner.match(/<Button\b/g) ?? []).toHaveLength(1);
        expect(card.inner).toMatch(/variant="primary"/);
        expect(card.inner).toMatch(/Choose your team/);
      }
    }

    expect(offlineCapableLabel("/print-farm")).toBe("Print farm");
    expect(offlineCapableLabel("/team/knowledge")).toBe("Playbook");
    expect(offlineCapableLabel("/inspection-copilot")).toBe("Inspection");
    const printChrome = readFileSync(join(WEB, "app/print-farm/print-farm-chrome.tsx"), "utf8");
    expect(printChrome).toMatch(/title="Print farm"/);
    expect(printChrome).not.toMatch(/title="3D Print Farm"/);
    const inspection = readFileSync(join(WEB, "app/inspection/inspection-client.tsx"), "utf8");
    expect(inspection).not.toMatch(/Inspection copilot/);
    const usage = readFileSync(join(WEB, "app/team/usage/usage-client.tsx"), "utf8");
    expect(usage).toMatch(/local_cli: "This computer"/);
    expect(usage).not.toMatch(/Local CLI/);
    const keysUsage = readFileSync(join(WEB, "app/team/ai-usage/ai-usage-client.tsx"), "utf8");
    expect(keysUsage).toMatch(/local_cli: "This computer"/);
    expect(keysUsage).not.toMatch(/Local CLI/);
  });

  it("Playbook last snapshot uses if (!view) and related stays Team chat / FMEA / Decisions", () => {
    const src = readFileSync(join(WEB, "app/team/knowledge/knowledge-client.tsx"), "utf8");
    expect(src).toMatch(/if \(!view\)/);
    expect(src).toMatch(/getFeatureSnapshot/);
    expect(src).toMatch(/putFeatureSnapshot/);
    expect(src).toMatch(/"knowledge"/);
    expect(src).toMatch(/badge="Needs setup"/);
    expect(src).toMatch(/KNOWLEDGE_RELATED_INCLUDE/);
    expect(src).toMatch(/aria-label="Related team tools"/);
  });
});
