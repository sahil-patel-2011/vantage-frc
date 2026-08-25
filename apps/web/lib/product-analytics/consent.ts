/**
 * The analytics consent choice, as data.
 *
 * One cookie, two possible answers, read the same way on the client (to decide
 * whether the tracker exists at all) and on the server (to decide whether an
 * insert is allowed at all). Both sides import this module so they cannot
 * disagree about what "consented" means.
 *
 * The cookie is intentionally NOT httpOnly: the browser tracker has to be able
 * to check it before it queues anything, and the value is a preference, not a
 * secret. It carries no identifier.
 */

/** Name of the cookie that stores the choice. Itself a necessary cookie. */
export const ANALYTICS_CONSENT_COOKIE = "vantage-analytics-consent";

/**
 * Bumped only when what we collect materially changes. A stored choice from an
 * older version stops counting as consent, so the banner asks again rather than
 * quietly reusing a yes given to different terms.
 */
export const ANALYTICS_CONSENT_VERSION = 1;

/** One year. Long enough not to nag, short enough that the answer is re-asked. */
export const ANALYTICS_CONSENT_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

export type ConsentChoice = "granted" | "denied";

export type ConsentState = {
  choice: ConsentChoice;
  version: number;
};

/** Cookie value format: `granted.1` / `denied.1`. Nothing else is stored. */
export function serializeConsent(choice: ConsentChoice, version = ANALYTICS_CONSENT_VERSION): string {
  return `${choice}.${version}`;
}

/**
 * Parse a cookie value. Returns null for anything unrecognised — a corrupted or
 * hand-edited cookie is treated as "no choice made yet", never as consent.
 */
export function parseConsent(raw: string | null | undefined): ConsentState | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (!value) return null;
  const match = /^(granted|denied)\.(\d{1,4})$/.exec(value);
  if (!match) return null;
  return { choice: match[1] as ConsentChoice, version: Number(match[2]) };
}

/**
 * The single question every caller actually asks. True only for an explicit
 * "granted" recorded against the current version — absence, a decline, a stale
 * version, and a malformed value all mean no.
 */
export function hasAnalyticsConsent(raw: string | null | undefined): boolean {
  const state = parseConsent(raw);
  return state !== null && state.choice === "granted" && state.version === ANALYTICS_CONSENT_VERSION;
}

/**
 * True when the banner still needs to ask. A decline is a real answer, so the
 * banner stays away until the person reopens it from the privacy page.
 */
export function needsConsentDecision(raw: string | null | undefined): boolean {
  const state = parseConsent(raw);
  if (state === null) return true;
  return state.version !== ANALYTICS_CONSENT_VERSION;
}

/**
 * Pull one cookie out of a raw `Cookie:` header. Used server-side, where the
 * header is the only thing we have.
 */
export function readCookie(header: string | null | undefined, name: string): string | null {
  if (typeof header !== "string" || !header) return null;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    if (part.slice(0, index).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(index + 1).trim());
    } catch {
      return part.slice(index + 1).trim();
    }
  }
  return null;
}

/** Server-side gate: does this request carry current, granted consent? */
export function requestHasAnalyticsConsent(headers: Headers): boolean {
  return hasAnalyticsConsent(readCookie(headers.get("cookie"), ANALYTICS_CONSENT_COOKIE));
}

/**
 * The Set-Cookie attributes used when a choice is recorded. `Lax` because the
 * cookie is never needed on a cross-site request; `Secure` only over https so
 * local http development still works.
 */
export function consentCookieAttributes(secure: boolean): string {
  const parts = ["Path=/", `Max-Age=${ANALYTICS_CONSENT_MAX_AGE_SECONDS}`, "SameSite=Lax"];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}
