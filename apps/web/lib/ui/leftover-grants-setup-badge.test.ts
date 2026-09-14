import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

describe("leftover Business grants student copy", () => {
  it("uses student chrome", () => {
    const src = readFileSync(join(WEB, "app/business/business-panels.tsx"), "utf8");
    expect(src).not.toMatch(/: "Setup"/);
    expect(src).toMatch(/Needs setup/);
  });
});
