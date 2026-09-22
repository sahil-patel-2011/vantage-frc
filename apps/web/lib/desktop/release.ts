/**
 * Shape the desktop updater reads. Old shells want { version, minimumVersion,
 * url, sha256 }. Newer ones also want named downloads for MSI / NSIS / DMG.
 * Pure mapping — no fetch — so the route and the tests share one parser.
 */

export type DesktopDownloads = {
  win_msi: string | null;
  win_nsis: string | null;
  mac_dmg: string | null;
};

export type DesktopSha256ByDownload = {
  win_nsis: string | null;
  win_msi: string | null;
  mac_dmg: string | null;
};

export type DesktopReleaseNotes = {
  headline: string;
  added: string[];
  fixed: string[];
  next: string[];
};

export type DesktopRelease = {
  version: string;
  minimumSupported: string;
  minimumVersion: string;
  url: string;
  sha256: string;
  downloads: DesktopDownloads;
  notes: string | null;
  publishedAt: string | null;
  unsigned: true;
  /** Per-file digests. A Mac shell refuses a DMG that only has the Windows hash. */
  sha256ByDownload?: DesktopSha256ByDownload;
  releaseNotes?: DesktopReleaseNotes;
};

/** GitHub Releases asset written by `.github/workflows/desktop.yml` on `desktop-v*`. */
export const DEFAULT_DESKTOP_RELEASE_URL =
  "https://github.com/sahil-patel-2011/vantage-frc/releases/latest/download/latest.json";

export const DESKTOP_RELEASE_MISSING = "No desktop release published yet.";
const NO_RELEASE = DESKTOP_RELEASE_MISSING;
const FEED_DOWN = "Desktop release feed is unavailable.";
const FEED_UNUSABLE = "Desktop release feed was not usable.";

const ALLOWED_HOSTS = [
  "github.com",
  "objects.githubusercontent.com",
  "release-assets.githubusercontent.com",
  "vantage-frc-web.vercel.app",
];

function allowedHttps(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  const host = url.hostname.toLowerCase();
  if (!ALLOWED_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`))) {
    return null;
  }
  return url.toString();
}

function sha256Hex(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const hex = raw.trim().toLowerCase();
  return /^[0-9a-f]{64}$/.test(hex) ? hex : null;
}

function versionOf(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const match = /(\d+(?:\.\d+)*)/.exec(raw.trim());
  return match ? raw.trim() : null;
}

/** Accepts GitHub latest.json (old or new) and returns the public API body. */
export function normalizeDesktopRelease(raw: unknown): DesktopRelease | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const version = versionOf(row.version);
  if (!version) return null;
  const sha256 = sha256Hex(row.sha256);
  if (!sha256) return null;

  const downloadsRaw =
    row.downloads && typeof row.downloads === "object"
      ? (row.downloads as Record<string, unknown>)
      : {};
  const downloads: DesktopDownloads = {
    win_nsis: allowedHttps(downloadsRaw.win_nsis) ?? allowedHttps(row.url),
    win_msi: allowedHttps(downloadsRaw.win_msi),
    mac_dmg: allowedHttps(downloadsRaw.mac_dmg),
  };
  const url = downloads.win_nsis;
  if (!url) return null;

  const floorRaw =
    typeof row.minimumSupported === "string"
      ? row.minimumSupported
      : typeof row.minimumVersion === "string"
        ? row.minimumVersion
        : "0.0.0";
  const minimumSupported = versionOf(floorRaw) ? floorRaw.trim() : "0.0.0";
  const notes = typeof row.notes === "string" ? row.notes.slice(0, 2000) : null;
  const publishedAt = typeof row.publishedAt === "string" ? row.publishedAt : null;

  return {
    version,
    minimumSupported,
    minimumVersion: minimumSupported,
    url,
    sha256,
    downloads,
    notes,
    publishedAt,
    unsigned: true,
  };
}

export function desktopReleaseUnavailable(reason: string) {
  return {
    error: reason,
    version: null,
    minimumSupported: "0.0.0",
    downloads: { win_msi: null, win_nsis: null, mac_dmg: null } satisfies DesktopDownloads,
    unsigned: true as const,
  };
}

function noteList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 12)
    .map((item) => item.slice(0, 240));
}

/** Keep digests and release notes the shell already reads, after the URL allowlist passes. */
export function publishDesktopRelease(raw: unknown): DesktopRelease | null {
  const base = normalizeDesktopRelease(raw);
  if (!base || !raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const scoped =
    row.sha256ByDownload && typeof row.sha256ByDownload === "object"
      ? (row.sha256ByDownload as Record<string, unknown>)
      : null;
  const sha256ByDownload = scoped
    ? {
        win_nsis: sha256Hex(scoped.win_nsis) ?? base.sha256,
        win_msi: sha256Hex(scoped.win_msi),
        mac_dmg: sha256Hex(scoped.mac_dmg),
      }
    : undefined;
  const notesRaw = row.releaseNotes;
  let releaseNotes: DesktopReleaseNotes | undefined;
  if (notesRaw && typeof notesRaw === "object") {
    const notes = notesRaw as Record<string, unknown>;
    const headline = typeof notes.headline === "string" ? notes.headline.trim().slice(0, 200) : "";
    if (headline) {
      releaseNotes = {
        headline,
        added: noteList(notes.added),
        fixed: noteList(notes.fixed),
        next: noteList(notes.next),
      };
    }
  }
  return {
    ...base,
    ...(sha256ByDownload ? { sha256ByDownload } : {}),
    ...(releaseNotes ? { releaseNotes } : {}),
  };
}

export type PublishedDesktopRelease =
  | { ok: true; release: DesktopRelease }
  | { ok: false; body: ReturnType<typeof desktopReleaseUnavailable> };

/**
 * Read the public GitHub manifest. A missing release is 503 with an empty
 * download set — never an invented URL. Network failures use the same shape
 * so the desktop shell can fall through to GitHub itself.
 */
export async function loadPublishedDesktopRelease(
  fetchImpl: typeof fetch = fetch,
  manifestUrl: string = DEFAULT_DESKTOP_RELEASE_URL,
): Promise<PublishedDesktopRelease> {
  let response: Response;
  try {
    response = await fetchImpl(manifestUrl, {
      cache: "no-store",
      headers: { accept: "application/json", "user-agent": "vantage-desktop-release" },
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    return { ok: false, body: desktopReleaseUnavailable(FEED_DOWN) };
  }
  if (response.status === 404) {
    return { ok: false, body: desktopReleaseUnavailable(NO_RELEASE) };
  }
  if (!response.ok) {
    return { ok: false, body: desktopReleaseUnavailable(FEED_DOWN) };
  }
  let raw: unknown;
  try {
    raw = await response.json();
  } catch {
    return { ok: false, body: desktopReleaseUnavailable(FEED_UNUSABLE) };
  }
  const release = publishDesktopRelease(raw);
  if (!release) return { ok: false, body: desktopReleaseUnavailable(FEED_UNUSABLE) };
  return { ok: true, release };
}
