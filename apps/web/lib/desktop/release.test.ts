import { describe, expect, it } from "vitest";
import { desktopReleaseUnavailable, normalizeDesktopRelease } from "./release";

const NSIS =
  "https://github.com/sahil-patel-2011/vantage-frc/releases/download/desktop-v0.3.0/Vantage-0.3.0-win-x64-setup.exe";
const MSI =
  "https://github.com/sahil-patel-2011/vantage-frc/releases/download/desktop-v0.3.0/Vantage-0.3.0-win-x64.msi";
const DMG =
  "https://github.com/sahil-patel-2011/vantage-frc/releases/download/desktop-v0.3.0/Vantage-0.3.0-mac-universal.dmg";

describe("normalizeDesktopRelease", () => {
  it("accepts the original latest.json shape the installed shells already fetch", () => {
    const release = normalizeDesktopRelease({
      version: "0.3.0",
      minimumVersion: "0.1.0",
      url: NSIS,
      sha256: "a".repeat(64),
    });
    expect(release?.url).toBe(NSIS);
    expect(release?.downloads.win_nsis).toBe(NSIS);
    expect(release?.minimumSupported).toBe("0.1.0");
    expect(release?.unsigned).toBe(true);
  });

  it("reads named downloads and aliases minimumSupported", () => {
    const release = normalizeDesktopRelease({
      version: "0.4.0",
      minimumSupported: "0.2.0",
      sha256: "b".repeat(64),
      downloads: { win_nsis: NSIS, win_msi: MSI, mac_dmg: DMG },
      notes: "Unsigned. SmartScreen will warn.",
    });
    expect(release?.downloads).toEqual({ win_nsis: NSIS, win_msi: MSI, mac_dmg: DMG });
    expect(release?.minimumVersion).toBe("0.2.0");
  });

  it("refuses an off-allowlist download host", () => {
    expect(
      normalizeDesktopRelease({
        version: "0.3.0",
        url: "https://evil.example/Vantage.exe",
        sha256: "a".repeat(64),
      }),
    ).toBeNull();
  });
});

describe("desktopReleaseUnavailable", () => {
  it("is honest when GitHub has no desktop-v* release yet", () => {
    const body = desktopReleaseUnavailable("No desktop release published yet.");
    expect(body.version).toBeNull();
    expect(body.unsigned).toBe(true);
  });
});
