/**
 * "Where you're signed in" on the Security page (QA A1-10).
 *
 * A lost phone, a laptop left at an event, or a student who left the team stayed signed in for up
 * to a week with nothing anyone could do. The page lists this person's own sessions and can end
 * the others. Only a description of each reaches the browser: never the session token, and not
 * the IP address.
 */

export type SessionRow = {
  id: string;
  userAgent?: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
  expiresAt: Date | string;
};

export type SessionView = {
  id: string;
  device: string;
  current: boolean;
  signedInAt: string;
  lastActiveAt: string;
};

function browserOf(agent: string): string | null {
  if (/VantageDesktop|Electron\//i.test(agent)) return "Vantage desktop app";
  if (/Edg(e|A|iOS)?\//.test(agent)) return "Edge";
  if (/SamsungBrowser\//.test(agent)) return "Samsung Internet";
  if (/OPR\/|Opera/.test(agent)) return "Opera";
  if (/Firefox\/|FxiOS\//.test(agent)) return "Firefox";
  if (/Chrome\/|CriOS\//.test(agent)) return "Chrome";
  if (/Safari\//.test(agent) && /Version\//.test(agent)) return "Safari";
  return null;
}

function systemOf(agent: string): string | null {
  if (/iPhone/.test(agent)) return "iPhone";
  if (/iPad/.test(agent)) return "iPad";
  if (/Android/.test(agent)) return "Android";
  if (/CrOS/.test(agent)) return "Chromebook";
  if (/Windows/.test(agent)) return "Windows";
  if (/Macintosh|Mac OS X/.test(agent)) return "Mac";
  if (/Linux/.test(agent)) return "Linux";
  return null;
}

/** "Chrome on Windows", "Safari on iPhone", or a plain fallback; never the raw string. */
export function describeUserAgent(agent: string | null | undefined): string {
  const text = (agent ?? "").slice(0, 512);
  const browser = browserOf(text);
  const system = systemOf(text);
  if (browser && system) return `${browser} on ${system}`;
  return browser ?? (system ? `A browser on ${system}` : "An unknown browser");
}

function iso(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date(0).toISOString();
}

/** Live sessions, this one first, then the most recently active. */
export function sessionViews(rows: SessionRow[], currentId: string, now: number): SessionView[] {
  return rows
    .filter((row) => new Date(row.expiresAt).getTime() > now)
    .map((row) => ({
      id: row.id,
      device: describeUserAgent(row.userAgent),
      current: row.id === currentId,
      signedInAt: iso(row.createdAt),
      lastActiveAt: iso(row.updatedAt),
    }))
    .sort((a, b) => Number(b.current) - Number(a.current) || b.lastActiveAt.localeCompare(a.lastActiveAt));
}
