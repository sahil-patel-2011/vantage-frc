import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const PAGE = join(__dirname, "../../app/desktop/page.tsx");

describe("desktop download page student copy", () => {
  const src = readFileSync(PAGE, "utf8");

  it("does not dump CLI, OAuth, NSIS, or the CAD CLI name", () => {
    expect(src).not.toMatch(/vantage-cad/);
    expect(src).not.toMatch(/\bOAuth\b/);
    expect(src).not.toMatch(/npm run desktop:dist/);
    expect(src).not.toMatch(/\bNSIS\b/);
    expect(src).not.toMatch(/desktop-v\*/);
    expect(src).not.toMatch(/hosted app in a native window/);
  });

  it("tells a student how to get the Windows app and that unsigned is expected", () => {
    expect(src).toMatch(/Windows downloads/);
    expect(src).toMatch(/SmartScreen/);
    expect(src).toMatch(/signing certificate/);
    expect(src).toMatch(/GitHub Releases/);
    expect(src).toMatch(/docs\/DESKTOP\.md/);
  });
});
