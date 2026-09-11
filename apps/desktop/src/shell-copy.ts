import { isLoopbackOrigin } from "./allowlist";

/**
 * Student-facing copy for the bundled desktop pages (offline / gate / update).
 * Mentors read these too. Do not name Electron, Chromium, Vercel, VANTAGE_URL,
 * NSIS, or the production hostname here — those belong in docs/DESKTOP.md.
 */

/** Chromium net error codes from `did-fail-load` (net/base/net_error_list.h). */
export const NET_ERR = {
  ABORTED: -3,
  TIMED_OUT: -7,
  NETWORK_CHANGED: -21,
  CONNECTION_CLOSED: -100,
  CONNECTION_RESET: -101,
  CONNECTION_REFUSED: -102,
  CONNECTION_FAILED: -104,
  NAME_NOT_RESOLVED: -105,
  INTERNET_DISCONNECTED: -106,
  SSL_PROTOCOL_ERROR: -107,
  ADDRESS_UNREACHABLE: -109,
  CONNECTION_TIMED_OUT: -118,
  NAME_RESOLUTION_FAILED: -137,
  NETWORK_ACCESS_DENIED: -138,
} as const;

export const OFFLINE_REASONS = ["offline", "timeout", "local", "unreachable"] as const;
export type OfflineReason = (typeof OFFLINE_REASONS)[number];

export type OfflineCopy = {
  title: string;
  body: string;
  retry: string;
  hint: string;
};

export const OFFLINE_RETRY = "Try again";
export const OFFLINE_HINT = "Ctrl+R also tries again.";

export const OFFLINE_COPY: Record<OfflineReason, { title: string; body: string }> = {
  offline: {
    title: "You're offline",
    body: "This computer is not connected. Check Wi-Fi, then try again.",
  },
  timeout: {
    title: "Can't reach Vantage",
    body: "Vantage took too long to answer. Venue Wi-Fi can do this — try again in a moment.",
  },
  local: {
    title: "Can't reach Vantage",
    body: "Vantage isn't running on this computer yet. Start it, then try again.",
  },
  unreachable: {
    title: "Can't reach Vantage",
    body: "Vantage isn't reachable right now. Check your connection, then try again.",
  },
};

export function parseOfflineReason(raw: string | null | undefined): OfflineReason {
  if (raw === "offline" || raw === "timeout" || raw === "local" || raw === "unreachable") return raw;
  return "unreachable";
}

export function offlineReasonFromLoadError(errorCode: number, origin: string): OfflineReason {
  if (
    errorCode === NET_ERR.INTERNET_DISCONNECTED ||
    errorCode === NET_ERR.NETWORK_ACCESS_DENIED ||
    errorCode === NET_ERR.NETWORK_CHANGED
  ) {
    return "offline";
  }
  if (errorCode === NET_ERR.TIMED_OUT || errorCode === NET_ERR.CONNECTION_TIMED_OUT) {
    return "timeout";
  }
  if (errorCode === NET_ERR.CONNECTION_REFUSED && isLoopbackOrigin(origin)) {
    return "local";
  }
  return "unreachable";
}

export function offlineCopy(reason: OfflineReason): OfflineCopy {
  const copy = OFFLINE_COPY[reason];
  return { ...copy, retry: OFFLINE_RETRY, hint: OFFLINE_HINT };
}

export const GATE_UNSUPPORTED_TITLE = "Update needed";
export const GATE_UNSUPPORTED_BODY =
  "This copy of Vantage is too old to sign in. Download a new copy and replace this app.";

export const UPDATE_STATUS_UNAVAILABLE_TITLE = "Couldn't check for an update";
export const UPDATE_STATUS_UNAVAILABLE_BODY = "Try again when you're online.";

export const UPDATE_COPY = {
  none: {
    title: "Vantage is up to date",
    body: "You're on the current Windows app. Team pages update on their own when you reopen them.",
  },
  required: {
    title: "Update needed",
    body: "This copy of Vantage is too old to work with the website. Update before you keep going.",
  },
  overdue: {
    title: "Update ready to install",
    body: "A newer Vantage app has been waiting. It will install the next time you close this window — never during a match.",
  },
  optional: {
    title: "Update available",
    body: "A newer Vantage app is available. It will install quietly the next time you close this window.",
  },
} as const;

export const UPDATE_PORTABLE_NOTE =
  "This copy of Vantage is a single file. Download the new file and replace this one.";

export const UPDATE_SAFETY =
  "Updates never install while Vantage is in use. A pending update is applied when you close the app, or after several minutes with the window idle and off a match-day screen — never in the middle of a match.";

/**
 * Map an internal updater failure into a sentence a student can act on.
 * Never pass the raw Node / Chromium message through to the window.
 */
export function studentUpdateError(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const text = raw.trim();
  if (!text) return null;
  const lower = text.toLowerCase();
  if (/digest|sha-?256|checksum|mismatch/.test(lower)) {
    return "The download didn't look right, so it was not installed. Try again.";
  }
  if (/too large/.test(lower)) {
    return "The update file was too big to install. Download a new copy instead.";
  }
  if (
    /enotfound|econnrefused|etimedout|eai_again|network|offline|fetch|download|timed out|abort/.test(
      lower,
    ) ||
    /^\d{3}$/.test(text)
  ) {
    return "Couldn't download the update. Check your connection and try again.";
  }
  return "The update could not be installed. Try again, or download a new copy.";
}
