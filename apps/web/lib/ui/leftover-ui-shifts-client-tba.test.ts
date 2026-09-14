import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

describe("leftover Shift balancer client student copy", () => {
  it("uses student chrome", () => {
    const src = readFileSync(join(WEB, "app/shift-balancer/shift-balancer-client.tsx"), "utf8");
    expect(src).not.toContain("Sync TBA or generate a numeric plan below.");
    expect(src).toContain("Sync Team Data or generate a numeric plan below.");
  });
});
