import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..", "..", "..");

describe("leftover Feature map Link an Onshape or Fusion document setup wording student copy", () => {
  it("uses student chrome", () => {
    const src = readFileSync(join(ROOT, "docs/FEATURE_MAP.md"), "utf8");
    expect(src).toContain("Paste a document URL. Onshape is validated by the real grammar (`@vantage/cad/onshape-url-parse`); Fusion is an Autodesk share URL (`a360.co` / hub). Kept as a vault entry with `external_url` and no bytes. Empty keeps one **Link a CAD document** primary; related stays in the header. Onshape links use one **Edit in Onshape** primary (official document URL / embed). Fusion share links use one **Edit in Fusion** primary (opens the live Autodesk document — no hosted iframe). Setup badge is **Needs setup**. No team (401/403) paints **Choose your team**, not a load error. From Build › CAD / Home, this is the student path — no OAuth or env-var names. Last snapshot stays on this phone (`if (!view)`). Empty keeps one primary. Student chrome says **Needs setup**, not Setup.");
  });
});
