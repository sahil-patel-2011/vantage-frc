import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

describe("leftover Home checklist student copy", () => {
  it("uses student chrome", () => {
    const src = readFileSync(join(WEB, "app/dashboard/widgets/widget-empty-copy.ts"), "utf8");
    expect(src).not.toMatch(/Finish setup/);
    expect(src).toMatch(/Choose your team/);
  });
});
