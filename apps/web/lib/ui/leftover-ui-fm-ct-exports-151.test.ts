import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..", "..", "..");

describe("leftover Feature map Exports choose team student copy", () => {
  it("uses student chrome", () => {
    const src = readFileSync(join(ROOT, "docs/FEATURE_MAP.md"), "utf8");
    expect(src).toContain("Audited CSV/ZIP takeout; team AI chats/memory/artifacts are on this team; private AI is member-only; keys never included Setup badge is **Needs setup**. No-team primary is **Choose your team**.");
  });
});
