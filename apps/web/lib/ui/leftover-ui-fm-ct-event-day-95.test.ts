import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..", "..", "..");

describe("leftover Feature map Event Day choose team student copy", () => {
  it("uses student chrome", () => {
    const src = readFileSync(join(ROOT, "docs/FEATURE_MAP.md"), "utf8");
    expect(src).toContain("Field-side command; empty/setup + next actions; travel/lodging clarity strip; last snapshot stays on this phone when venue Wi-Fi dies. Load/mutate/shell is `command-client.tsx`; chrome, event picker, and the painted workbench live in sibling modules. Setup badge is **Needs setup**. Student chrome says set the event you’re at — no Connect TBA / The Blue Alliance. Next-action Open uses `Button`. No nested TabBar. Header related strip is **Packing · Match checklist · Tool checkout · Inspection**. Featured inner tools include **Match video** (paste-and-confirm) and **Packing**. No-team primary is **Choose your team**.");
  });
});
