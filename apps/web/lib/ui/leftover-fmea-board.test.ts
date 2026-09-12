import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

/**
 * Leftover student FMEA / RPN / O×S×D chrome on the Failure log board.
 * Route `/fmea`, IndexedDB `"fmea"`, and identifiers stay. Do not source-scan
 * `fmea-related.ts` comments — generated copy is locked in fmea-related.test.ts.
 */
const FILES = [
  "app/fmea/fmea-client.tsx",
  "app/fmea/page.tsx",
  "lib/offline/shell-routes.ts",
] as const;

describe("leftover student Failure log board chrome", () => {
  it("does not print leftover FMEA or RPN phrases on this family", () => {
    for (const rel of FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/Failure Log \(FMEA\)/);
      expect(src, rel).not.toMatch(/Open FMEA/);
      expect(src, rel).not.toMatch(/Could not refresh FMEA/);
      expect(src, rel).not.toMatch(/Battery reliability → FMEA/);
      expect(src, rel).not.toMatch(/O×S×D/);
      expect(src, rel).not.toMatch(/O\/S\/D/);
      expect(src, rel).not.toMatch(/Highest RPN|Top RPN|avg RPN|max RPN|Preview RPN/);
      expect(src, rel).not.toMatch(/feature="FMEA"/);
    }
    const client = readFileSync(join(WEB, "app/fmea/fmea-client.tsx"), "utf8");
    expect(client).toMatch(/title="Failure log"/);
    expect(client).toMatch(/feature="Failure log"/);
    expect(client).toMatch(/How often/);
    expect(client).toMatch(/How bad/);
    expect(client).toMatch(/How hard to notice/);
    expect(client).toMatch(/getFeatureSnapshot[\s\S]*"fmea"/);
    const page = readFileSync(join(WEB, "app/fmea/page.tsx"), "utf8");
    expect(page).toMatch(/title: "Failure log"/);
    const routes = readFileSync(join(WEB, "lib/offline/shell-routes.ts"), "utf8");
    expect(routes).toMatch(/startsWith\("\/fmea"\)\) return "Failure log"/);
  });
});
