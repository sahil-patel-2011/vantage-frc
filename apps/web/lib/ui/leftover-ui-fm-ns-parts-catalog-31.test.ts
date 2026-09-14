import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..", "..", "..");

describe("leftover Feature map Parts catalog needs setup student copy", () => {
  it("uses student chrome", () => {
    const src = readFileSync(join(ROOT, "docs/FEATURE_MAP.md"), "utf8");
    expect(src).toContain("Curated COTS reference in code (`lib/parts-catalog/catalog.ts`): spec, use, aliases, vendor link; no prices, SKUs only where certain. \"Add to inventory\" creates the row at 0 on hand with vendor/part number/unit/reorder point; \"Request it\" prefills Part requests; items already in inventory are marked from the same data Inventory uses Setup badge is **Needs setup**.");
  });
});
