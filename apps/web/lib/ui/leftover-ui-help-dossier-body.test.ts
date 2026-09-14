import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

describe("leftover Help dossier body student copy", () => {
  it("uses student chrome", () => {
    const src = readFileSync(join(WEB, "lib/help/articles.ts"), "utf8");
    expect(src).not.toContain("Profile, seasons and awards come from The Blue Alliance.");
    expect(src).toContain("Profile, seasons and awards come from Team Data.");
  });
});
