import { describe, expect, it } from "vitest";
import {
  desktopReleaseUnavailable,
  loadPublishedDesktopRelease,
  normalizeDesktopRelease,
  publishDesktopRelease,
} from "./release";

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

describe("publishDesktopRelease", () => {
  it("keeps per-file digests and the written release notes", () => {
    const release = publishDesktopRelease({
      version: "0.4.0",
      minimumSupported: "0.2.0",
      sha256: "b".repeat(64),
      downloads: { win_nsis: NSIS, win_msi: MSI, mac_dmg: DMG },
      sha256ByDownload: {
        win_nsis: "b".repeat(64),
        win_msi: "c".repeat(64),
        mac_dmg: "d".repeat(64),
      },
      releaseNotes: { headline: "Window remembers its size", added: ["MSI"], fixed: [], next: ["Signing"] },
    });
    expect(release?.sha256ByDownload?.mac_dmg).toBe("d".repeat(64));
    expect(release?.releaseNotes?.headline).toBe("Window remembers its size");
  });

  it("drops a manifest whose download host is not allowlisted", () => {
    expect(
      publishDesktopRelease({
        version: "0.3.0",
        url: "https://evil.example/Vantage.exe",
        sha256: "a".repeat(64),
      }),
    ).toBeNull();
  });
});

describe("loadPublishedDesktopRelease", () => {
  it("returns 503-shaped body when GitHub has no release", async () => {
    const fetchImpl = (async () => new Response("missing", { status: 404 })) as typeof fetch;
    const result = await loadPublishedDesktopRelease(fetchImpl, "https://github.com/example/latest.json");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.body.version).toBeNull();
      expect(result.body.error).toMatch(/no desktop release/i);
    }
  });

  it("returns the allowlisted manifest when GitHub answers", async () => {
    const fetchImpl = (async () =>
      Response.json({
        version: "0.4.0",
        sha256: "b".repeat(64),
        downloads: { win_nsis: NSIS, mac_dmg: DMG },
        sha256ByDownload: { win_nsis: "b".repeat(64), mac_dmg: "d".repeat(64) },
      })) as typeof fetch;
    const result = await loadPublishedDesktopRelease(fetchImpl, "https://github.com/example/latest.json");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.release.url).toBe(NSIS);
      expect(result.release.sha256ByDownload?.mac_dmg).toBe("d".repeat(64));
    }
  });

  it("does not invent a URL when the feed is down", async () => {
    const fetchImpl = (async () => {
      throw new Error("offline");
    }) as typeof fetch;
    const result = await loadPublishedDesktopRelease(fetchImpl, "https://github.com/example/latest.json");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.body.downloads.win_nsis).toBeNull();
  });
});
