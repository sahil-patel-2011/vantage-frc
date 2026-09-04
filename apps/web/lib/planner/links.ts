/** Shared https join / attachment links for calendar meetings and team todos. */

export const MAX_ATTACHED_LINKS = 12;
export const MAX_LINK_URL_CHARS = 500;
export const MAX_LINK_LABEL_CHARS = 80;

export type AttachedLink = {
  label: string;
  url: string;
};

/** Human label for a meeting join URL. */
export function meetingProvider(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host === "zoom.us" || host.endsWith(".zoom.us")) return "Zoom";
    if (host === "meet.google.com") return "Google Meet";
    if (host === "teams.microsoft.com" || host === "teams.live.com") return "Teams";
    if (host === "discord.gg" || host === "discord.com" || host.endsWith(".discord.com")) return "Discord";
    return "Meeting";
  } catch {
    return null;
  }
}

/** Short label for an attached doc / CAD / sheet URL. */
export function linkLabelFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    const path = parsed.pathname.toLowerCase();
    if (host === "docs.google.com" && path.startsWith("/spreadsheets")) return "Google Sheet";
    if (host === "docs.google.com") return "Google Doc";
    if (host === "sheets.google.com") return "Google Sheet";
    if (host === "drive.google.com") return "Google Drive";
    if (host === "meet.google.com") return "Google Meet";
    if (host.endsWith("onshape.com")) return "Onshape";
    if (host === "github.com" || host === "gist.github.com") return "GitHub";
    if (host.endsWith("notion.so") || host.endsWith("notion.site")) return "Notion";
    if (host === "zoom.us" || host.endsWith(".zoom.us")) return "Zoom";
    return host || "Link";
  } catch {
    return "Link";
  }
}

/** Validate an optional https URL. Empty → null. */
export function optionalHttpsUrl(value: unknown, label = "Link"): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  if (!text) return null;
  if (text.length > MAX_LINK_URL_CHARS) {
    throw new Error(`${label} must be ${MAX_LINK_URL_CHARS} characters or fewer`);
  }
  let parsed: URL;
  try {
    parsed = new URL(text);
  } catch {
    throw new Error(`${label} must be a full https:// URL`);
  }
  if (parsed.protocol !== "https:") throw new Error(`${label} must use https`);
  if (!parsed.hostname.includes(".")) throw new Error(`${label} must be a full https:// URL`);
  return parsed.toString();
}

function oneLink(value: unknown): AttachedLink | null {
  if (typeof value === "string") {
    const url = optionalHttpsUrl(value, "Link");
    if (!url) return null;
    return { label: linkLabelFromUrl(url), url };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as { label?: unknown; url?: unknown };
  const url = optionalHttpsUrl(record.url ?? record, "Link");
  if (!url) return null;
  const rawLabel = typeof record.label === "string" ? record.label.trim() : "";
  const label = (rawLabel || linkLabelFromUrl(url)).slice(0, MAX_LINK_LABEL_CHARS);
  return { label, url };
}

/** Parse a JSON array (or JSON string) of attached https links. Drops blanks. */
export function parseAttachedLinks(value: unknown): AttachedLink[] {
  let source: unknown = value;
  if (typeof value === "string" && value.trim()) {
    try {
      source = JSON.parse(value) as unknown;
    } catch {
      const single = oneLink(value);
      return single ? [single] : [];
    }
  }
  if (!Array.isArray(source)) return [];
  const out: AttachedLink[] = [];
  const seen = new Set<string>();
  for (const item of source) {
    const link = oneLink(item);
    if (!link || seen.has(link.url)) continue;
    seen.add(link.url);
    out.push(link);
    if (out.length >= MAX_ATTACHED_LINKS) break;
  }
  return out;
}

/** Same as parseAttachedLinks but throws when a provided URL is invalid. */
export function requireAttachedLinks(value: unknown): AttachedLink[] {
  if (value == null || value === "") return [];
  if (typeof value === "string" && !value.trim()) return [];
  let source: unknown = value;
  if (typeof value === "string") {
    try {
      source = JSON.parse(value) as unknown;
    } catch {
      const url = optionalHttpsUrl(value, "Link");
      return url ? [{ label: linkLabelFromUrl(url), url }] : [];
    }
  }
  if (!Array.isArray(source)) throw new Error("Links must be a list");
  if (source.length > MAX_ATTACHED_LINKS) {
    throw new Error(`At most ${MAX_ATTACHED_LINKS} links`);
  }
  const out: AttachedLink[] = [];
  const seen = new Set<string>();
  for (const item of source) {
    const link = oneLink(item);
    if (!link) continue;
    if (seen.has(link.url)) continue;
    seen.add(link.url);
    out.push(link);
  }
  return out;
}

export function linksToJson(links: AttachedLink[]): string {
  return JSON.stringify(links);
}

export function describeAttachedLinks(links: AttachedLink[]): string {
  return links.map((link) => `${link.label}: ${link.url}`).join("\n");
}
