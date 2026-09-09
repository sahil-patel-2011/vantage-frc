import { describe, expect, it } from "vitest";
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
  currentUrl: "https://vantage-frc-web.vercel.app/dashboard",
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

describe("manifest validation", () => {
  it("accepts a well-formed manifest", () => {
    expect(parseManifest({ ...MANIFEST })).toEqual(MANIFEST);
  });

  it("refuses a non-https or off-allowlist download host", () => {
    expect(parseManifest({ ...MANIFEST, url: "http://github.com/x/y/z.exe" })).toBeNull();
    expect(parseManifest({ ...MANIFEST, url: "https://evil.example/Vantage-setup.exe" })).toBeNull();
    expect(
      parseManifest({ ...MANIFEST, url: "https://vantage-frc-web.vercel.app/downloads/setup.exe" }),
    ).not.toBeNull();
  });

  it("refuses a missing or malformed digest — the digest is the whole trust story", () => {
    expect(parseManifest({ ...MANIFEST, sha256: "" })).toBeNull();
    expect(parseManifest({ ...MANIFEST, sha256: "abc" })).toBeNull();
    expect(parseManifest({ ...MANIFEST, sha256: "Z".repeat(64) })).toBeNull();
  });

  it("defaults an absent floor to 0.0.0 and clamps one above the release", () => {
    const noFloor = parseManifest({ ...MANIFEST, minimumVersion: undefined });
    expect(noFloor?.minimumVersion).toBe("0.0.0");
    const silly = parseManifest({ ...MANIFEST, minimumVersion: "9.9.9" });
    expect(silly?.minimumVersion).toBe("0.3.0");
  });

  it("rejects junk", () => {
    expect(parseManifest(null)).toBeNull();
    expect(parseManifest("0.3.0")).toBeNull();
    expect(parseManifest({ version: "nope", url: MANIFEST.url, sha256: MANIFEST.sha256 })).toBeNull();
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
      const url = `https://vantage-frc-web.vercel.app${path}`;
      expect(installWindow({ ...BASE, plan: required, currentUrl: url })).toEqual({
        install: false,
        reason: "live-ops-surface",
      });
    }
  });

  it("does not treat a lookalike path as live ops", () => {
    expect(isLiveOpsUrl("https://vantage-frc-web.vercel.app/pitch-deck")).toBe(false);
    expect(isLiveOpsUrl("https://vantage-frc-web.vercel.app/pit")).toBe(true);
    expect(isLiveOpsUrl("https://vantage-frc-web.vercel.app/pit/notes")).toBe(true);
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
        currentUrl: "https://vantage-frc-web.vercel.app/scouting",
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
        currentUrl: "https://vantage-frc-web.vercel.app/scouting",
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
        currentUrl: "https://vantage-frc-web.vercel.app/scouting",
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
        currentUrl: "https://vantage-frc-web.vercel.app/dashboard",
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
        currentUrl: "https://vantage-frc-web.vercel.app/dashboard",
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
