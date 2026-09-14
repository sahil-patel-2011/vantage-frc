import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

describe("leftover Watchlist EPA action student copy", () => {
  it("uses student chrome", () => {
    const src = readFileSync(join(WEB, "lib/opponent-watchlist/compute-opponent-watchlist.ts"), "utf8");
    expect(src).not.toContain("label: \"Open EPA Trend Alerts\"");
    expect(src).toContain("label: \"Open Rating alerts\"");
  });
});
