import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..", "..", "..");

describe("leftover Feature map Shell navigation needs setup student copy", () => {
  it("uses student chrome", () => {
    const src = readFileSync(join(ROOT, "docs/FEATURE_MAP.md"), "utf8");
    expect(src).toContain("**One overlay for navigation and search.** The island's **All** opens it; ⌘K and the ≥900px topbar **Search** open the same panel with its field focused. The island hides while the panel is up (it lists four of the same apps) and the topbar Search button is dropped while the panel is up, so there is **one search box and one nav opener on screen at every width**. The panel lists **one row per hub**; that row opens the default workbench. **The other workbenches hang under the hub row** (Competition: Scouting · Strategy · Pit; Team: Chat · People · Work · Playbook; Business: Money · Sponsors · Grants · Outreach; Build: CAD · Code · Robot) so All can land on them without a second hop through the hub TabBar. Nested tools stay off All — they live on the workbench ToolStrip. **Logistics** still carries Packing · Duties · Visit invites because it has no in-page tab bar. The team chip says **Choose your team** until a team is active. Footer is Customize island · Sign out; Account is the profile row. Report a bug / Support tickets / App manual live in the account menu. No topbar hamburger — it opened the same panel as **All** Setup badge is **Needs setup**.");
  });
});
