import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

describe("leftover Product glances student copy", () => {
  it("uses student chrome", () => {
    const src = readFileSync(join(WEB, "components/marketing/product-glances.tsx"), "utf8");
    expect(src).not.toContain("Active event from TBA");
    expect(src).toContain("Active event from Team Data");
  });
});
