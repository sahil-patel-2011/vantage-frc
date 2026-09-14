import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

describe("leftover Dossier UI rows student copy", () => {
  it("uses student chrome", () => {
    const src = readFileSync(join(WEB, "app/dossier/dossier-client.tsx"), "utf8");
    expect(src).not.toContain("real TBA/Statbotics rows exist.");
    expect(src).toContain("real Team Data rows exist.");
  });
});
