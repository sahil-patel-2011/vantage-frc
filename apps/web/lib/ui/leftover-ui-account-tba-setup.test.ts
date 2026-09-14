import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

describe("leftover Account TBA setup student copy", () => {
  it("uses student chrome", () => {
    const src = readFileSync(join(WEB, "lib/account/account-api-related.ts"), "utf8");
    expect(src).not.toMatch(/Connect The Blue Alliance/);
    expect(src).toMatch(/Sync Team Data/);
  });
});
