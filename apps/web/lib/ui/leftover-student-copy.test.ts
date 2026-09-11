import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

/**
 * Leftover student chrome not skip-list and not in open PRs #2–#39:
 * CAD viewport, Files, Why panel, Print Farm, Event Day / Logistics chrome,
 * and the sponsored-AI banner still said PNG / object storage / setup required
 * / weighted round-robin / OctoPrint.
 */
const FILES = [
  "app/cad/cad-viewport.tsx",
  "lib/cad/shaded-view.ts",
  "app/files/files-panels.tsx",
  "app/files/files-model.ts",
  "app/files/upload-queue.ts",
  "components/why-panel.tsx",
  "components/sponsored-promo-banner.tsx",
  "app/api/organizations/sponsored-promo/route.ts",
  "app/print-farm/print-farm-chrome.tsx",
  "app/command/command-chrome.tsx",
  "app/logistics/logistics-chrome.tsx",
] as const;

describe("leftover student engineering copy", () => {
  it("does not say PNG, object storage, setup required, round-robin, or OctoPrint", () => {
    for (const rel of FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/shaded-view PNG/i);
      expect(src, rel).not.toMatch(/\bobject storage\b/i);
      expect(src, rel).not.toMatch(/\bsetup required\b/i);
      expect(src, rel).not.toMatch(/weighted round-robin/i);
      expect(src, rel).not.toMatch(/OctoPrint/i);
      expect(src, rel).not.toMatch(/\bG-code\b/i);
      expect(src, rel).not.toMatch(/\bChecksumming\b/);
    }
  });
});
