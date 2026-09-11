import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

describe("leftover student chrome on Form, Security, Bring your season, and Media", () => {
  it("Media sections are a ToolStrip, not a nested hub TabBar", () => {
    const src = readFileSync(join(WEB, "app/media/media-live-workspace.tsx"), "utf8");
    expect(src).toMatch(/aria-label="Media sections"/);
    expect(src).toMatch(/<ToolStrip/);
    expect(src).not.toMatch(/<TabBar/);
    expect(src).not.toMatch(/product-hub-tabs/);
  });

  it("claiming a team does not say URL slug", () => {
    const src = readFileSync(join(WEB, "app/claim/claim-client.tsx"), "utf8");
    expect(src).toMatch(/Short name/);
    expect(src).not.toMatch(/URL slug/);
  });
});
