import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..", "..", "..");

describe("leftover Feature map Bring your season choose team student copy", () => {
  it("uses student chrome", () => {
    const src = readFileSync(join(ROOT, "docs/FEATURE_MAP.md"), "utf8");
    expect(src).toContain("ICS inbound + paste + pull; scout CSV commit with identity lock; hours CSV → attendance; Notion JSON → calendar/knowledge/tasks; OAuth stays setup_required until `NOTION_CLIENT_ID` Setup badge is **Needs setup**. No-team primary is **Choose your team**.");
  });
});
