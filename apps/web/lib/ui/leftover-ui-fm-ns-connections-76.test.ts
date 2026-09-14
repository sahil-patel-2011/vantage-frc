import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..", "..", "..");

describe("leftover Feature map Connections needs setup student copy", () => {
  it("uses student chrome", () => {
    const src = readFileSync(join(ROOT, "docs/FEATURE_MAP.md"), "utf8");
    expect(src).toContain("Onshape connect / status / disconnect, document list + paste-link, Fusion paste-link **Edit in Fusion** + pair. Connected only from real rows. Cross-links to Account / CAD / Discord / Slack. Setup badge is **Needs setup**.");
  });
});
