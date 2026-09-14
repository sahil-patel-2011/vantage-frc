import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..", "..", "..");

describe("leftover Feature map Logistics needs setup student copy", () => {
  it("uses student chrome", () => {
    const src = readFileSync(join(ROOT, "docs/FEATURE_MAP.md"), "utf8");
    expect(src).toContain("Hotels, rooming, travel legs, checklist, on-duty mentors; empty/setup + next actions; hotel/travel clarity; cross-links to Event Day / My Day / Team calendar / Visit invites; tripId/hotelId on this team. Load/mutate/shell is `logistics-client.tsx`; chrome, day-of, mentor planning, and trips live in sibling modules. Next-action Open uses `Button`. Trip switcher is a ToolStrip (`aria-label=\"Trips\"`), not a nested TabBar. Setup badge is **Needs setup**.");
  });
});
