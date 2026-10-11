/**
 * Links to each team's spreadsheet copy (Google Sheets / Excel), remembered on this device
 * while Vantage works so they can be offered in the "Vantage is limited" banner when the
 * database — and with it the endpoint that knows the links — is down.
 *
 * Browser-safe, no imports. Only the links and file names are kept: never the sheet's data.
 */

export const SHEET_COPIES_KEY = "vantage.sheet-copies.v1";
export const SHEET_COPIES_REFRESH_MS = 12 * 60 * 60 * 1000;
const MAX_TEAMS = 6;

export type SheetCopyKind = "google" | "excel";
export type CachedCopy = { kind: SheetCopyKind; url: string; name: string | null };
export type CachedTeam = { label: string | null; savedAt: string; copies: CachedCopy[] };
export type SheetCopyCache = Record<string, CachedTeam>;

type StorageLike = Pick<Storage, "getItem" | "setItem">;

const GOOGLE_HOSTS = [/^docs\.google\.com$/, /^drive\.google\.com$/, /^sheets\.google\.com$/];
const EXCEL_HOSTS = [
  /^onedrive\.live\.com$/,
  /^1drv\.ms$/,
  /^[a-z0-9-]+(-my)?\.sharepoint\.com$/,
  /(^|\.)office\.com$/,
  /(^|\.)live\.com$/,
  /(^|\.)cloud\.microsoft$/,
];

/** An https link on the provider's own domain, or null. */
export function safeCopyUrl(kind: SheetCopyKind, value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2_000) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  const hosts = kind === "google" ? GOOGLE_HOSTS : EXCEL_HOSTS;
  return hosts.some((pattern) => pattern.test(url.hostname.toLowerCase())) ? url.toString() : null;
}

/** The connected copies from GET /api/integrations/mirror/status. */
export function copiesFromMirrorStatus(body: unknown): CachedCopy[] {
  const copies = (body as { copies?: unknown } | null)?.copies;
  if (!Array.isArray(copies)) return [];
  const out: CachedCopy[] = [];
  for (const entry of copies) {
    const copy = entry as { copy?: unknown; connected?: unknown; fileUrl?: unknown; fileName?: unknown };
    const kind = copy.copy === "google" ? "google" : copy.copy === "excel" ? "excel" : null;
    if (!kind || copy.connected !== true) continue;
    const url = safeCopyUrl(kind, copy.fileUrl);
    if (!url) continue;
    out.push({ kind, url, name: typeof copy.fileName === "string" ? copy.fileName.slice(0, 120) : null });
  }
  return out;
}

export function readSheetCopies(storage: StorageLike | null): SheetCopyCache {
  try {
    const raw = storage?.getItem(SHEET_COPIES_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    if (!parsed || typeof parsed !== "object") return {};
    const cache: SheetCopyCache = {};
    for (const [orgId, team] of Object.entries(parsed as Record<string, CachedTeam>)) {
      if (!team || !Array.isArray(team.copies) || typeof team.savedAt !== "string") continue;
      const copies = team.copies.flatMap((copy) => {
        const url = safeCopyUrl(copy.kind, copy.url);
        return url ? [{ kind: copy.kind, url, name: typeof copy.name === "string" ? copy.name : null }] : [];
      });
      cache[orgId] = { label: typeof team.label === "string" ? team.label : null, savedAt: team.savedAt, copies };
    }
    return cache;
  } catch {
    return {};
  }
}

export function shouldRefreshSheetCopies(cache: SheetCopyCache, orgId: string, now = Date.now()): boolean {
  const saved = cache[orgId]?.savedAt;
  return !saved || !(now - Date.parse(saved) < SHEET_COPIES_REFRESH_MS);
}

/** Save this team's links (an empty list forgets them), newest teams first, a few at most. */
export function rememberSheetCopies(
  storage: StorageLike | null,
  orgId: string,
  label: string | null,
  copies: CachedCopy[],
  now = Date.now(),
): SheetCopyCache {
  const cache = readSheetCopies(storage);
  delete cache[orgId];
  const next: SheetCopyCache = { [orgId]: { label, savedAt: new Date(now).toISOString(), copies } };
  for (const [id, team] of Object.entries(cache).slice(0, MAX_TEAMS - 1)) next[id] = team;
  try {
    storage?.setItem(SHEET_COPIES_KEY, JSON.stringify(next));
  } catch {
    // Private mode or full storage: the banner just won't have links.
  }
  return next;
}

/** The current team's copies first, then other teams this device has used. */
export function bannerLinks(cache: SheetCopyCache, orgId: string | null): Array<CachedCopy & { team: string | null }> {
  const ordered = [
    ...(orgId && cache[orgId] ? [[orgId, cache[orgId]] as const] : []),
    ...Object.entries(cache).filter(([id]) => id !== orgId),
  ];
  const links: Array<CachedCopy & { team: string | null }> = [];
  for (const [, team] of ordered) {
    for (const copy of team.copies) links.push({ ...copy, team: team.label });
  }
  return links.slice(0, 4);
}
