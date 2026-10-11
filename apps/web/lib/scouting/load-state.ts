/**
 * What to tell a scout when the scouting data did not load fresh.
 *
 * Every failure (a timeout, a 401, a 403, a 429, a 500) used to read "Offline · using this
 * phone's saved copy", including on a phone with full signal. At a venue the Wi-Fi is usually
 * "connected but slow", and a scout told "offline" stops trusting the schedule they are
 * scouting from, or reloads and gets nothing. Each case now says what happened and what helps.
 *
 * Pure, so it is tested.
 */

/** Scouting's own wait for its bootstrap: it carries the schedule and every report you filed. */
export const SCOUTING_LOAD_TIMEOUT_MS = 20_000;
/** While a saved copy is on screen after a failure, try the live one again this often. */
export const SCOUTING_RETRY_MS = 30_000;

export type ScoutLoadFailure =
  /** The phone says it has no network. */
  | "offline"
  /** The request ran out of time. */
  | "slow"
  /** No answer at all while the phone says it is online (dropped connection, captive portal). */
  | "unreachable"
  /** The server answered with an error (5xx, 429). */
  | "server"
  /** 401: the session ended. */
  | "signed-out"
  /** 403: this person can no longer open this team's scouting. */
  | "forbidden";

export function classifyScoutLoadFailure(input: { online: boolean; status: number | null; timedOut: boolean }): ScoutLoadFailure {
  if (!input.online) return "offline";
  if (input.status === 401) return "signed-out";
  if (input.status === 403) return "forbidden";
  if (input.timedOut) return "slow";
  if (input.status === null) return "unreachable";
  return "server";
}

/** Worth trying again by itself: not when the answer was "sign in" or "no access". */
export function retriesByItself(failure: ScoutLoadFailure): boolean {
  return failure === "slow" || failure === "unreachable" || failure === "server";
}

/** "from 3 minutes ago", "from 2 hours ago", "from Oct 10"; empty when unknown. */
export function copyAge(cachedAt: string | null | undefined, now: number = Date.now()): string {
  const at = cachedAt ? Date.parse(cachedAt) : NaN;
  if (!Number.isFinite(at)) return "";
  const minutes = Math.max(0, Math.round((now - at) / 60_000));
  if (minutes < 1) return " from just now";
  if (minutes < 60) return ` from ${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return ` from ${hours} hour${hours === 1 ? "" : "s"} ago`;
  return ` from ${new Date(at).toLocaleDateString([], { month: "short", day: "numeric" })}`;
}

/** The line above a screen that is showing the phone's saved copy instead of a fresh one. */
export function savedCopyBanner(failure: ScoutLoadFailure, cachedAt: string | null, now: number = Date.now()): string {
  const age = copyAge(cachedAt, now);
  switch (failure) {
    case "offline":
      return `No signal · using this phone’s saved copy${age}. Saves send when the signal is back.`;
    case "slow":
      return `Slow connection · showing this phone’s copy${age} while it keeps trying.`;
    case "unreachable":
    case "server":
      return `Your team’s server didn’t answer · showing this phone’s copy${age} while it keeps trying.`;
    case "signed-out":
      return "You are signed out · showing this phone’s saved copy. Sign in again so what you save can send.";
    case "forbidden":
      return "Your access to this team changed · showing this phone’s saved copy. Ask a team owner or admin.";
  }
}

/** The empty screen when nothing loaded and the phone has no saved copy either. */
export function loadFailedCopy(failure: ScoutLoadFailure): { description: string; action: "retry" | "sign-in" | "none" } {
  switch (failure) {
    case "offline":
      return {
        description: "This phone has no saved copy of your event yet. Open Scouting once with a signal, then it works offline.",
        action: "retry",
      };
    case "signed-out":
      return { description: "You are signed out. Sign in again to load your team’s matches.", action: "sign-in" };
    case "forbidden":
      return {
        description: "You can’t open this team’s scouting any more. If that’s a mistake, ask a team owner or admin.",
        action: "none",
      };
    case "slow":
      return { description: "The connection is too slow to load your team’s matches right now. Try again in a moment.", action: "retry" };
    case "unreachable":
    case "server":
      return { description: "Your team’s server didn’t answer. Try again in a moment.", action: "retry" };
  }
}
