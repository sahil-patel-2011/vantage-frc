import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..", "..", "..");

describe("leftover Feature map CAD connections needs setup student copy", () => {
  it("uses student chrome", () => {
    const src = readFileSync(join(ROOT, "docs/FEATURE_MAP.md"), "utf8");
    expect(src).toContain("Connect Onshape in the browser, pick a document from the list or paste a link, disconnect. Fusion: paste a share link and **Edit in Fusion**, or pair this computer. Missing Fusion config is **Needs setup**. Last snapshot (`feature: \"cad-connections\"`) stays on the phone. 401/403 with no cache is **Choose your team** (one primary). Student permissions copy — no OAuth / env names. Setup badge is **Needs setup**.");
  });
});
