import { describe, expect, it } from "vitest";
import { PRODUCTION_APP_HOSTS } from "../src/allowlist";
import {
  compareVersions,
  decideUpdate,
  IDLE_BEFORE_INSTALL_MS,
  IDLE_BEFORE_WEB_RELOAD_MS,
  installWindow,
  isLiveOpsUrl,
  isStaleAssetRequest,
  manifestUrlForRepo,
  parseManifest,
  parseVersion,
  shouldInstallOnQuit,
  shouldReloadWeb,
  UPDATE_DEADLINE_MS,
  type ReleaseManifest,
} from "../src/update";

const MANIFEST: ReleaseManifest = {
  version: "0.3.0",
  minimumVersion: "0.1.0",
  url: "https://github.com/sahil-patel-2011/vantage-frc/releases/download/desktop-v0.3.0/Vantage-0.3.0-win-x64-setup.exe",
  sha256: "a".repeat(64),
};

const BASE = {
  downloadReady: true,
  now: 1_000_000,
  idleMs: IDLE_BEFORE_INSTALL_MS + 1,
  windowFocused: false,
  currentUrl: "https://vantagefrc.vercel.app/dashboard",
  online: true,
  portable: false,
};

describe("version parsing", () => {
  it("reads bare, v-prefixed and tag-prefixed versions", () => {
    expect(parseVersion("0.2.0")).toEqual([0, 2, 0]);
    expect(parseVersion("v1.4")).toEqual([1, 4]);
    expect(parseVersion("desktop-v0.10.3")).toEqual([0, 10, 3]);
    expect(parseVersion("not a version")).toBeNull();
    expect(parseVersion(undefined)).toBeNull();
  });

  it("compares numerically, not lexically", () => {
    expect(compareVersions("0.9.0", "0.10.0")).toBe(-1);
    expect(compareVersions("1.0", "1.0.0")).toBe(0);
    expect(compareVersions("2.0.1", "2.0.0")).toBe(1);
  });

  it("treats an unreadable version as equal so a bad manifest is inert", () => {
    expect(compareVersions("0.1.0", "garbage")).toBe(0);
  });
});

// Pinned to win32 throughout. These test *validation* — bad hosts, bad
// digests, junk input — not platform selection, and `parseManifest` defaults
// to `process.platform`. Left unpinned they passed on a Windows box and failed
// on CI's Linux runner, which is the whole class of bug CI exists to catch.
describe("manifest validation", () => {
  it("accepts a well-formed manifest", () => {
    expect(parseManifest({ ...MANIFEST }, "win32")).toEqual(MANIFEST);
  });

  it("refuses a non-https or off-allowlist download host", () => {
    expect(parseManifest({ ...MANIFEST, url: "http://github.com/x/y/z.exe" }, "win32")).toBeNull();
    expect(parseManifest({ ...MANIFEST, url: "https://evil.example/Vantage-setup.exe" }, "win32")).toBeNull();
    // Against the shared list rather than a literal: this asserted
    // `vantagefrc.vercel.app`, which is retired, so it was checking that
    // a host nobody can reach is an acceptable place to fetch an installer.
    for (const host of PRODUCTION_APP_HOSTS) {
      expect(
        parseManifest({ ...MANIFEST, url: `https://${host}/downloads/setup.exe` }, "win32"),
        `${host} should be an allowed download host`,
      ).not.toBeNull();
    }
  });

  it("refuses a missing or malformed digest — the digest is the whole trust story", () => {
    expect(parseManifest({ ...MANIFEST, sha256: "" }, "win32")).toBeNull();
    expect(parseManifest({ ...MANIFEST, sha256: "abc" }, "win32")).toBeNull();
    expect(parseManifest({ ...MANIFEST, sha256: "Z".repeat(64) }, "win32")).toBeNull();
  });

  it("defaults an absent floor to 0.0.0 and clamps one above the release", () => {
    const noFloor = parseManifest({ ...MANIFEST, minimumVersion: undefined }, "win32");
    expect(noFloor?.minimumVersion).toBe("0.0.0");
    const silly = parseManifest({ ...MANIFEST, minimumVersion: "9.9.9" }, "win32");
    expect(silly?.minimumVersion).toBe("0.3.0");
  });

  it("rejects junk", () => {
    expect(parseManifest(null, "win32")).toBeNull();
    expect(parseManifest("0.3.0", "win32")).toBeNull();
    expect(parseManifest({ version: "nope", url: MANIFEST.url, sha256: MANIFEST.sha256 }, "win32")).toBeNull();
  });

  it("builds the GitHub release manifest URL", () => {
    expect(manifestUrlForRepo("sahil-patel-2011/vantage-frc")).toBe(
      "https://github.com/sahil-patel-2011/vantage-frc/releases/latest/download/latest.json",
    );
  });
});

describe("what is owed", () => {
  it("is none when current, ahead, or manifest-less", () => {
    expect(decideUpdate({ currentVersion: "0.3.0", manifest: MANIFEST, now: 0 }).kind).toBe("none");
    expect(decideUpdate({ currentVersion: "0.4.0", manifest: MANIFEST, now: 0 }).kind).toBe("none");
    expect(decideUpdate({ currentVersion: "0.1.0", manifest: null, now: 0 }).kind).toBe("none");
  });

  it("starts the two-day clock the first time this shell sees the version", () => {
    const plan = decideUpdate({ currentVersion: "0.2.0", manifest: MANIFEST, now: 5_000 });
    expect(plan.kind).toBe("optional");
    if (plan.kind === "optional") expect(plan.deadlineAt).toBe(5_000 + UPDATE_DEADLINE_MS);
  });

  it("counts from first sight, not from release date — a bagged laptop gets its full grace", () => {
    const firstSeenAt = 1_000;
    const plan = decideUpdate({
      currentVersion: "0.2.0",
      manifest: MANIFEST,
      now: firstSeenAt + UPDATE_DEADLINE_MS - 1,
      state: { firstSeenAt },
    });
    expect(plan.kind).toBe("optional");
  });

  it("goes overdue once the deadline passes", () => {
    const firstSeenAt = 1_000;
    const plan = decideUpdate({
      currentVersion: "0.2.0",
      manifest: MANIFEST,
      now: firstSeenAt + UPDATE_DEADLINE_MS,
      state: { firstSeenAt },
    });
    expect(plan.kind).toBe("overdue");
  });

  it("is required — not deferrable — below the floor the web app declares", () => {
    const plan = decideUpdate({
      currentVersion: "0.0.9",
      manifest: MANIFEST,
      now: 0,
      state: { deferredVersion: "0.3.0", deferredUntil: Number.MAX_SAFE_INTEGER },
    });
    expect(plan.kind).toBe("required");
  });

  it("honours a deferral until it expires", () => {
    const firstSeenAt = 1_000;
    const now = firstSeenAt + UPDATE_DEADLINE_MS + 1;
    const deferred = decideUpdate({
      currentVersion: "0.2.0",
      manifest: MANIFEST,
      now,
      state: { firstSeenAt, deferredVersion: "0.3.0", deferredUntil: now + 60_000 },
    });
    expect(deferred.kind).toBe("optional");
    const expired = decideUpdate({
      currentVersion: "0.2.0",
      manifest: MANIFEST,
      now,
      state: { firstSeenAt, deferredVersion: "0.3.0", deferredUntil: now - 1 },
    });
    expect(expired.kind).toBe("overdue");
  });
});

describe("competition-day safeguard", () => {
  const overdue = { kind: "overdue" as const, version: "0.3.0", deadlineAt: 0 };
  const required = { kind: "required" as const, version: "0.3.0", deadlineAt: 0 };

  it("installs an overdue update only when the window is genuinely idle", () => {
    expect(installWindow({ ...BASE, plan: overdue })).toEqual({
      install: true,
      reason: "overdue-and-idle",
    });
  });

  it("never installs while somebody is looking at the window", () => {
    expect(installWindow({ ...BASE, plan: overdue, windowFocused: true }).install).toBe(false);
    expect(installWindow({ ...BASE, plan: required, windowFocused: true }).install).toBe(false);
  });

  it("never installs seconds after a keystroke", () => {
    expect(installWindow({ ...BASE, plan: overdue, idleMs: 30_000 })).toEqual({
      install: false,
      reason: "recently-used",
    });
  });

  it("never installs on a live-ops surface, however overdue", () => {
    for (const path of ["/matches", "/scouting/lineup", "/pit", "/display/pit", "/strategy", "/hours/kiosk"]) {
      const url = `https://vantagefrc.vercel.app${path}`;
      expect(installWindow({ ...BASE, plan: required, currentUrl: url })).toEqual({
        install: false,
        reason: "live-ops-surface",
      });
    }
  });

  it("does not treat a lookalike path as live ops", () => {
    expect(isLiveOpsUrl("https://vantagefrc.vercel.app/pitch-deck")).toBe(false);
    expect(isLiveOpsUrl("https://vantagefrc.vercel.app/pit")).toBe(true);
    expect(isLiveOpsUrl("https://vantagefrc.vercel.app/pit/notes")).toBe(true);
    expect(isLiveOpsUrl("")).toBe(false);
  });

  it("leaves optional updates completely alone", () => {
    const optional = { kind: "optional" as const, version: "0.3.0", deadlineAt: 0 };
    expect(installWindow({ ...BASE, plan: optional })).toEqual({
      install: false,
      reason: "not-due-yet",
    });
  });

  it("refuses without a verified download, offline, or on a portable build", () => {
    expect(installWindow({ ...BASE, plan: overdue, downloadReady: false }).reason).toBe("no-verified-download");
    expect(installWindow({ ...BASE, plan: overdue, online: false }).reason).toBe("offline");
    expect(installWindow({ ...BASE, plan: overdue, portable: true }).reason).toBe("portable-build");
  });

  it("lets the user override the idle wait, but not the missing download", () => {
    expect(
      installWindow({ ...BASE, plan: overdue, windowFocused: true, idleMs: 0, userRequested: true }).install,
    ).toBe(true);
    expect(
      installWindow({ ...BASE, plan: overdue, downloadReady: false, userRequested: true }).install,
    ).toBe(false);
  });

  it("always installs on quit — the session is ending anyway", () => {
    expect(shouldInstallOnQuit({ plan: overdue, downloadReady: true, portable: false })).toBe(true);
    const optional = { kind: "optional" as const, version: "0.3.0", deadlineAt: 0 };
    expect(shouldInstallOnQuit({ plan: optional, downloadReady: true, portable: false })).toBe(true);
    expect(shouldInstallOnQuit({ plan: { kind: "none" }, downloadReady: true, portable: false })).toBe(false);
    expect(shouldInstallOnQuit({ plan: overdue, downloadReady: false, portable: false })).toBe(false);
    expect(shouldInstallOnQuit({ plan: overdue, downloadReady: true, portable: true })).toBe(false);
  });
});

describe("stale hosted page after a web deploy", () => {
  it("spots a dead content-hashed chunk", () => {
    expect(isStaleAssetRequest("https://x/_next/static/chunks/app-1a2b.js", 404)).toBe(true);
    expect(isStaleAssetRequest("https://x/_next/static/chunks/app-1a2b.js", 200)).toBe(false);
    expect(isStaleAssetRequest("https://x/api/my-day", 404)).toBe(false);
  });

  it("reloads immediately when the page is already broken", () => {
    expect(
      shouldReloadWeb({
        staleAssetSeen: true,
        idleMs: 0,
        windowFocused: true,
        currentUrl: "https://vantagefrc.vercel.app/scouting",
        online: true,
        pageBroken: true,
      }),
    ).toBe(true);
  });

  it("will not yank a focused live-ops page out from under a scout", () => {
    expect(
      shouldReloadWeb({
        staleAssetSeen: true,
        idleMs: IDLE_BEFORE_WEB_RELOAD_MS * 2,
        windowFocused: true,
        currentUrl: "https://vantagefrc.vercel.app/scouting",
        online: true,
      }),
    ).toBe(false);
  });

  it("picks the deploy up quietly once the window is not focused", () => {
    expect(
      shouldReloadWeb({
        staleAssetSeen: true,
        idleMs: 0,
        windowFocused: false,
        currentUrl: "https://vantagefrc.vercel.app/scouting",
        online: true,
      }),
    ).toBe(true);
  });

  it("refreshes a long-idle background window even with no stale signal", () => {
    expect(
      shouldReloadWeb({
        staleAssetSeen: false,
        idleMs: IDLE_BEFORE_WEB_RELOAD_MS,
        windowFocused: false,
        currentUrl: "https://vantagefrc.vercel.app/dashboard",
        online: true,
      }),
    ).toBe(true);
  });

  it("never reloads offline or on a local shell page", () => {
    expect(
      shouldReloadWeb({
        staleAssetSeen: true,
        idleMs: 0,
        windowFocused: false,
        currentUrl: "https://vantagefrc.vercel.app/dashboard",
        online: false,
      }),
    ).toBe(false);
    expect(
      shouldReloadWeb({
        staleAssetSeen: true,
        idleMs: 0,
        windowFocused: false,
        currentUrl: "file:///C:/app/gate.html",
        online: true,
      }),
    ).toBe(false);
  });
});

const REL = "https://github.com/sahil-patel-2011/vantage-frc/releases/download/desktop-v0.3.0";

describe("picking the build for this machine", () => {
  const multi = {
    version: "0.3.0",
    minimumVersion: "0.1.0",
    downloads: {
      win_nsis: `${REL}/Vantage-0.3.0-win-x64-setup.exe`,
      mac_dmg: `${REL}/Vantage-0.3.0-mac-arm64.dmg`,
    },
    sha256: "a".repeat(64),
    sha256ByDownload: { win_nsis: "a".repeat(64), mac_dmg: "b".repeat(64) },
  };

  it("hands Windows the installer and macOS the disk image", () => {
    expect(parseManifest(multi, "win32")?.url).toContain("setup.exe");
    expect(parseManifest(multi, "darwin")?.url).toContain(".dmg");
  });

  it("verifies the file it is actually downloading", () => {
    // One top-level digest was only ever right while there was one download.
    // With a Mac build published too it would check the wrong file and refuse
    // every install.
    expect(parseManifest(multi, "win32")?.sha256).toBe("a".repeat(64));
    expect(parseManifest(multi, "darwin")?.sha256).toBe("b".repeat(64));
  });

  it("offers nothing rather than a file the machine cannot open", () => {
    const winOnly = { ...multi, downloads: { win_nsis: multi.downloads.win_nsis }, sha256: "a".repeat(64) };
    expect(parseManifest(winOnly, "darwin")).toBeNull();
    expect(parseManifest(winOnly, "win32")).not.toBeNull();
  });

  it("still reads an old manifest that predates per-platform downloads", () => {
    expect(parseManifest({ ...MANIFEST }, "win32")?.url).toBe(MANIFEST.url);
    // That bare url is a Windows installer by construction, so a Mac must not
    // be handed it.
    expect(parseManifest({ ...MANIFEST }, "darwin")).toBeNull();
  });
});

describe("release notes", () => {
  const notes = {
    headline: "Predictions now work at off-season events",
    added: ["Match scores estimated from your own scouting"],
    fixed: ["The calendar opened on a grid you had to drag sideways"],
    next: ["Pit scouting on the same estimates"],
  };

  it("carries what changed, in three plain lists", () => {
    const parsed = parseManifest({ ...MANIFEST, releaseNotes: notes }, "win32");
    expect(parsed?.releaseNotes).toEqual(notes);
  });

  it("is absent rather than empty when there is no headline", () => {
    expect(parseManifest({ ...MANIFEST, releaseNotes: { added: ["x"] } }, "win32")?.releaseNotes).toBeUndefined();
    expect(parseManifest({ ...MANIFEST, releaseNotes: "nope" }, "win32")?.releaseNotes).toBeUndefined();
  });

  it("drops anything that is not a line of text", () => {
    const parsed = parseManifest({
      ...MANIFEST,
      releaseNotes: { headline: "Hi", added: ["real", 7, null, "  "], fixed: "not a list" },
    }, "win32");
    expect(parsed?.releaseNotes?.added).toEqual(["real"]);
    expect(parsed?.releaseNotes?.fixed).toEqual([]);
  });

  it("caps a manifest that tries to paste an essay into the window", () => {
    const parsed = parseManifest({
      ...MANIFEST,
      releaseNotes: {
        headline: "x".repeat(500),
        added: Array.from({ length: 40 }, (_, i) => `line ${i}`),
      },
    }, "win32");
    expect(parsed?.releaseNotes?.headline.length).toBe(200);
    expect(parsed?.releaseNotes?.added).toHaveLength(8);
  });
});

describe("not stranding shells that are already installed", () => {
  it("keeps reading the plain sha256 string an older manifest shape uses", () => {
    // Shells in the wild validate `sha256` with a 64-hex regex. If a release
    // ever publishes an object there instead, every one of them rejects the
    // manifest and stops updating — permanently, and without saying so.
    const legacy = {
      version: "0.3.0",
      minimumVersion: "0.1.0",
      downloads: { win_nsis: `${REL}/Vantage-0.3.0-win-x64-setup.exe` },
      sha256: "c".repeat(64),
    };
    expect(parseManifest(legacy, "win32")?.sha256).toBe("c".repeat(64));
  });

  it("never hands a non-Windows download the Windows digest", () => {
    const missingMacDigest = {
      version: "0.3.0",
      minimumVersion: "0.1.0",
      downloads: { mac_dmg: `${REL}/Vantage-0.3.0-mac-arm64.dmg` },
      sha256: "c".repeat(64),
    };
    // Better to offer no update than to check a DMG against an .exe hash and
    // either fail confusingly or, worse, pass something unverified.
    expect(parseManifest(missingMacDigest, "darwin")).toBeNull();
  });
});

describe("the platform a manifest is read for", () => {
  it("is an argument, so a test does not depend on the machine running it", () => {
    // These six assertions were the CI failure. `parseManifest` defaults to
    // `process.platform`, and the legacy fixture carries only a bare Windows
    // `url`, so the same test passed on a Windows laptop and failed on CI's
    // Linux runner. Asserting all three here means the behaviour is covered
    // rather than inherited.
    const legacy = { ...MANIFEST };
    expect(parseManifest(legacy, "win32")).toEqual(MANIFEST);
    expect(parseManifest(legacy, "darwin")).toBeNull();
    expect(parseManifest(legacy, "linux")).toBeNull();
  });

  it("offers nothing on a platform with no build rather than the wrong file", () => {
    const multi = {
      version: "0.3.0",
      minimumVersion: "0.1.0",
      downloads: {
        win_nsis: `${REL}/Vantage-0.3.0-win-x64-setup.exe`,
        mac_dmg: `${REL}/Vantage-0.3.0-mac-arm64.dmg`,
      },
      sha256ByDownload: { win_nsis: "a".repeat(64), mac_dmg: "b".repeat(64) },
      sha256: "a".repeat(64),
    };
    expect(parseManifest(multi, "linux")).toBeNull();
    expect(parseManifest(multi, "freebsd")).toBeNull();
  });
});
