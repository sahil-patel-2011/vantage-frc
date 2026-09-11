import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = __dirname;

describe("Dev Setup method switcher is not a nested tablist", () => {
  it("uses ToolStrip for alternate ways to do a step", () => {
    const src = readFileSync(join(DIR, "dev-setup-client.tsx"), "utf8");
    expect(src).toMatch(/ToolStrip/);
    expect(src).not.toMatch(/role="tablist"/);
    expect(src).not.toMatch(/role="tab"/);
  });
});
