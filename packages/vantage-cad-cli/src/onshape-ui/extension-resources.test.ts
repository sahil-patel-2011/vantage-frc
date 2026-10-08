import { describe, expect, it } from "vitest";
import { validateExtensionResourceManifest } from "./extension-resources";

describe("packaged browser boundary", () => {
  const manifest = { version: 1, platform: "darwin", arch: "arm64", browserExecutable: "browser/Chromium.app/Contents/MacOS/Chromium" };
  it("requires the exact installed operating system and processor", () => {
    expect(validateExtensionResourceManifest(manifest, "darwin", "arm64")).toBe(manifest.browserExecutable);
    expect(() => validateExtensionResourceManifest(manifest, "darwin", "x64")).toThrow("matching");
    expect(() => validateExtensionResourceManifest(manifest, "win32", "arm64")).toThrow("matching");
    expect(() => validateExtensionResourceManifest({ ...manifest, version: 2 }, "darwin", "arm64")).toThrow();
  });
  it("refuses absolute, parent-relative, unscoped and null-containing executables", () => {
    for (const browserExecutable of ["/bin/sh", "../browser/chrome", "browser/../../bin/sh", "browser\\..\\cmd.exe", "node", "browser/chrome\0--arg", ""]) {
      expect(() => validateExtensionResourceManifest({ ...manifest, browserExecutable }, "darwin", "arm64")).toThrow();
    }
    expect(validateExtensionResourceManifest({ version: 1, platform: "win32", arch: "x64", browserExecutable: "browser\\chrome.exe" }, "win32", "x64")).toBe("browser\\chrome.exe");
  });
});
