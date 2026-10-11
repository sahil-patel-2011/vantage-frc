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
      win: { signAndEditExecutable?: boolean; certificateFile?: string; azureSignOptions?: unknown };
      mac: { hardenedRuntime?: boolean; entitlements?: string; identity?: string | null };
      nsis: { license: string };
    };
  };
  const workflow = readFileSync(join(REPO, ".github/workflows/desktop.yml"), "utf8");
  const license = readFileSync(join(DESKTOP, "build/UNSIGNED.txt"), "utf8");
  const docs = readFileSync(join(REPO, "docs/DESKTOP.md"), "utf8");

  it("does not require a signing certificate to package Windows", () => {
    // Resource editing stays on, so the .exe carries the Vantage icon and product name; signing
    // only happens when a certificate is supplied at build time, never from the config.
    expect(pack.build.win.signAndEditExecutable).not.toBe(false);
    expect(pack.build.win.certificateFile).toBeUndefined();
    expect(pack.build.win.azureSignOptions).toBeUndefined();
    expect(pack.build.nsis.license).toBe("build/UNSIGNED.txt");
    expect(workflow).toMatch(/CSC_IDENTITY_AUTO_DISCOVERY:\s*"false"/);
    // Only the macOS job may receive a certificate (for notarization); Windows packages without one.
    const windowsJob = workflow.slice(workflow.indexOf("  windows:"), workflow.indexOf("  macos:"));
    expect(windowsJob).not.toMatch(/CSC_LINK:/);
    expect(workflow).toMatch(/xcrun stapler validate/);
  });

  it("tells the installer and the docs that the build is unsigned", () => {
    expect(license).toMatch(/unsigned/i);
    expect(license).toMatch(/SmartScreen/i);
    expect(docs).toMatch(/no Authenticode cert/);
    expect(docs).toMatch(/UNSIGNED\.txt/);
    expect(docs).toMatch(/VANTAGE_URL/);
    expect(docs).toMatch(/https:\/\/vantage-frc-web\.vercel\.app/);
  });

  it("is ready to notarize on macOS when Apple credentials are supplied", () => {
    expect(pack.build.mac.hardenedRuntime).toBe(true);
    expect(pack.build.mac.entitlements).toBe("build/entitlements.mac.plist");
    expect(pack.build.mac.identity).toBeUndefined();
    const entitlements = readFileSync(join(DESKTOP, "build/entitlements.mac.plist"), "utf8");
    expect(entitlements).toContain("com.apple.security.cs.allow-jit");
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
