import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

describe("leftover Business sponsors student copy", () => {
  it("uses student chrome", () => {
    const src = readFileSync(join(WEB, "app/business/sponsor-pipeline-panel.tsx"), "utf8");
    expect(src).not.toMatch(/: "Setup"/);
    expect(src).toMatch(/Needs setup/);
  });
});
