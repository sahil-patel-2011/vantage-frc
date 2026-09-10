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
};

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
