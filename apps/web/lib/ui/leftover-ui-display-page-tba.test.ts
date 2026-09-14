import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

describe("leftover Display page student copy", () => {
  it("uses student chrome", () => {
    const src = readFileSync(join(WEB, "app/display/page.tsx"), "utf8");
    expect(src).not.toContain("from TBA schedule and Strategy predictions");
    expect(src).toContain("from the official schedule and Strategy predictions");
  });
});
