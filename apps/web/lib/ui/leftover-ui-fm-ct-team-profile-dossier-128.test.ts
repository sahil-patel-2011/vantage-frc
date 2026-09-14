import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..", "..", "..");

describe("leftover Feature map Team profile (dossier) choose team student copy", () => {
  it("uses student chrome", () => {
    const src = readFileSync(join(ROOT, "docs/FEATURE_MAP.md"), "utf8");
    expect(src).toContain("What Team Data has on record: profile, rookie year → seasons competed, awards, last two attended seasons' events (rank/record/outcome), career + per-year EPA and ranks. Built on an owner/admin's first visit, refreshed weekly by the season-cron piggyback (≤20 teams/run, coordinated TBA client). People are NOT scraped — roster counts come from memberships. `loadOrgSessionFacts` carries it into every AI chat. Missing fields read \"not on record\", never a guess Setup badge is **Needs setup**. No-team primary is **Choose your team**.");
  });
});
