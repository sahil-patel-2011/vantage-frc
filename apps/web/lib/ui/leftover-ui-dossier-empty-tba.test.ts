import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

describe("leftover Dossier empty student copy", () => {
  it("uses student chrome", () => {
    const src = readFileSync(join(WEB, "lib/dossier/dossier-related.ts"), "utf8");
    expect(src).not.toContain("sync TBA identity + Statbotics EPA.");
    expect(src).toContain("sync Team Data.");
  });
});
