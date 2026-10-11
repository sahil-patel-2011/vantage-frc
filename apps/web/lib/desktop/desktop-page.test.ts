import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const PAGE = join(__dirname, "../../app/desktop/page.tsx");
const DOWNLOADS = join(__dirname, "../../app/desktop/desktop-downloads.tsx");

describe("desktop download page student copy", () => {
  const src = `${readFileSync(PAGE, "utf8")}\n${readFileSync(DOWNLOADS, "utf8")}`;

  it("does not dump CLI, OAuth, NSIS, or the CAD CLI name", () => {
    expect(src).not.toMatch(/vantage-cad/);
    expect(src).not.toMatch(/\bOAuth\b/);
    expect(src).not.toMatch(/npm run desktop:dist/);
    expect(src).not.toMatch(/\bNSIS\b/);
    expect(src).not.toMatch(/desktop-v\*/);
    expect(src).not.toMatch(/hosted app in a native window/);
  });

  it("tells a student how to get the Windows and Mac apps and that an unsigned Windows build is expected", () => {
    expect(src).toMatch(/Download for Windows/);
    expect(src).toMatch(/Download for Mac/);
    expect(src).toMatch(/mac_dmg/);
    expect(src).toMatch(/No Windows build is published yet/);
    expect(src).toMatch(/SmartScreen/);
    expect(src).toMatch(/signing certificate/);
    expect(src).not.toMatch(/vantage-frc\/releases/);
    expect(src).toMatch(/docs\/DESKTOP\.md/);
  });
});
