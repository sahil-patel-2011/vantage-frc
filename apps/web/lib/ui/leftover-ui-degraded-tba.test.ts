import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

describe("leftover Degraded mode student copy", () => {
  it("uses student chrome", () => {
    const src = readFileSync(join(WEB, "app/degraded-mode/degraded-mode-client.tsx"), "utf8");
    expect(src).not.toContain("Once TBA/Statbotics sync runs");
    expect(src).toContain("Once Team Data sync runs");
  });
});
