import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { offlineShellCopy } from "../offline/offline-related";

const WEB = join(__dirname, "..", "..");

describe("leftover This phone setup chrome", () => {
  it("setup is Needs setup, not Setup", () => {
    expect(offlineShellCopy("setup").badge).toBe("Needs setup");
    expect(offlineShellCopy("setup").title).toBe("Choose your team");
    const src = readFileSync(join(WEB, "lib/offline/offline-related.ts"), "utf8");
    expect(src).not.toMatch(/badge: "Setup"/);
  });
});
