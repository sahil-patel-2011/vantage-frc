import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

describe("leftover Logistics student copy", () => {
  it("uses student chrome", () => {
    const src = readFileSync(join(WEB, "lib/logistics/logistics-related.ts"), "utf8");
    expect(src).not.toMatch(/Finish setup for travel plans/);
    expect(src).toMatch(/title: "Choose your team"/);
    expect(src).toMatch(/join the waitlist/i);
  });

  it("offers the waitlist on the no-team card and stamps the active team", () => {
    const chrome = readFileSync(join(WEB, "app/logistics/logistics-chrome.tsx"), "utf8");
    const client = readFileSync(join(WEB, "app/logistics/logistics-client.tsx"), "utf8");
    expect(chrome).toContain('href="/#waitlist"');
    expect(chrome).toContain('"/workspace"');
    expect(chrome).toMatch(/Choose your team/);
    expect(client).toMatch(/persistOrgIdInUrl/);
  });
});
