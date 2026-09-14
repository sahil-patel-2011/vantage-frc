import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..", "..", "..");

describe("leftover Feature map Inventory & BOM needs setup student copy", () => {
  it("uses student chrome", () => {
    const src = readFileSync(join(ROOT, "docs/FEATURE_MAP.md"), "utf8");
    expect(src).toContain("Parts stock, locations, and per-mechanism BOM. Load/mutate/shell is `inventory-client.tsx`; items, locations, BOM, stock toolbar, and chrome live in sibling modules. Stock / Locations / BOM are a ToolStrip (`aria-label=\"Inventory sections\"`), not a nested TabBar. Empty keeps one **Add a part** primary; Vendors / Orders / Spare Forecast stay in the header related strip. Setup badge is **Needs setup**.");
  });
});
