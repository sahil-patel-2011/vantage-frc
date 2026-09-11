import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DESKTOP = join(__dirname, "..");
const REPO = join(DESKTOP, "..", "..");

/**
 * Unsigned Windows path — the smoke we can run without Authenticode or
 * notarization. electron-builder is not invoked here on purpose.
 */
describe("unsigned Windows desktop path", () => {
  const pack = JSON.parse(readFileSync(join(DESKTOP, "package.json"), "utf8")) as {
    build: {
      win: { signAndEditExecutable: boolean };
      nsis: { license: string };
    };
  };
  const workflow = readFileSync(join(REPO, ".github/workflows/desktop.yml"), "utf8");
  const license = readFileSync(join(DESKTOP, "build/UNSIGNED.txt"), "utf8");
  const docs = readFileSync(join(REPO, "docs/DESKTOP.md"), "utf8");

  it("does not require a signing certificate to package Windows", () => {
    expect(pack.build.win.signAndEditExecutable).toBe(false);
    expect(pack.build.nsis.license).toBe("build/UNSIGNED.txt");
    expect(workflow).toMatch(/CSC_IDENTITY_AUTO_DISCOVERY:\s*"false"/);
    expect(workflow).not.toMatch(/CSC_LINK:/);
  });

  it("tells the installer and the docs that the build is unsigned", () => {
    expect(license).toMatch(/unsigned/i);
    expect(license).toMatch(/SmartScreen/i);
    expect(docs).toMatch(/signAndEditExecutable:\s*false/);
    expect(docs).toMatch(/UNSIGNED\.txt/);
    expect(docs).toMatch(/VANTAGE_URL/);
    expect(docs).toMatch(/https:\/\/vantage-frc-web\.vercel\.app/);
  });

  it("does not wrap Freebuff from the desktop shell", () => {
    const allowlist = readFileSync(join(DESKTOP, "src/allowlist.ts"), "utf8");
    const main = readFileSync(join(DESKTOP, "src/main.ts"), "utf8");
    expect(allowlist).not.toMatch(/freebuff/i);
    expect(main).not.toMatch(/freebuff/i);
    expect(main).toContain("process.env.VANTAGE_URL");
    expect(allowlist).toContain("sanitizeAppOrigin");
  });
});
