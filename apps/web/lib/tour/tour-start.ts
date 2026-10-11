import { tourIsForNewMember } from "./tour-steps";

/**
 * When the tour starts, and why. Kept free of the DOM so the two rules the product promises can
 * be pinned by tests:
 *
 *   1. Once. The first-run tour starts at most once per account, on any device. The server's
 *      atomic claim (`claimFirstTour`, via POST /api/account/tour) is authoritative: only an
 *      onboarded account created in the last 14 days with no marker can win it, and only once.
 *      Nothing in the browser can start it again: not a cleared localStorage key, not another
 *      browser, not the desktop app, not an old account.
 *   2. On request. "Take the tour again" goes to Home with `?tour=replay`. That starts the tour
 *      whatever the once-only state is, and never touches the claim.
 */

export const TOUR_REPLAY_PARAM = "tour";
export const TOUR_REPLAY_VALUE = "replay";

/** True when the address asks for a replay: `?tour=replay`, with or without the leading "?". */
export function tourReplayRequested(search: string): boolean {
  return new URLSearchParams(search).get(TOUR_REPLAY_PARAM) === TOUR_REPLAY_VALUE;
}

/**
 * Where "Take the tour again" goes: Home, keeping the team. The shell's own links do the same
 * thing with withOrgHref; this one is built here so the account menu and the Help page cannot
 * disagree about the parameter.
 */
export function tourReplayHref(orgId: string | null | undefined): string {
  const params = new URLSearchParams({ [TOUR_REPLAY_PARAM]: TOUR_REPLAY_VALUE });
  if (orgId) params.set("orgId", orgId);
  return `/dashboard?${params.toString()}`;
}

/**
 * The same address without the replay parameter, for history.replaceState once the tour has
 * started: a reload (or a copied link) must not start it again. Everything else is kept.
 */
export function withoutReplayParam(href: string): string {
  const url = new URL(href, "https://vantage.invalid");
  if (url.searchParams.get(TOUR_REPLAY_PARAM) === TOUR_REPLAY_VALUE) url.searchParams.delete(TOUR_REPLAY_PARAM);
  return `${url.pathname}${url.search}${url.hash}`;
}

/** What /api/me says about the account, as far as the tour cares. */
export type TourAccount = {
  userId?: string;
  memberSince?: string | null;
  appTourSeen?: boolean;
  onboardingComplete?: boolean;
};

/**
 * Whether this account may be offered the first-run tour. Every answer except a clear "yes" is
 * "no": a missing flag, an unreadable date or a failed load all mean the tour waits.
 */
export function firstTourEligible(account: TourAccount | null | undefined, now: number = Date.now()): boolean {
  if (!account?.userId) return false;
  // The server has recorded the tour as shown, on this or any other device.
  if (account.appTourSeen !== false) return false;
  if (!account.onboardingComplete) return false;
  return tourIsForNewMember(account.memberSince, now);
}

export type TourStartMode = "replay" | "first-run" | "none";

/**
 * Decide how the tour starts. A replay request wins over everything (it is the person asking);
 * otherwise the first-run tour needs the browser not to have recorded it AND the account to be
 * eligible. This only says the tour may be offered: the server claim still has the last word.
 */
export function tourStartMode(input: {
  search: string;
  /** localStorage says this browser has already shown it (or storage cannot be read). */
  doneInBrowser: boolean;
  account: TourAccount | null | undefined;
  now?: number;
}): TourStartMode {
  if (tourReplayRequested(input.search)) return "replay";
  if (input.doneInBrowser) return "none";
  return firstTourEligible(input.account, input.now) ? "first-run" : "none";
}

/**
 * The last gate before the tour shows. A replay needs nothing from the server and never calls
 * the claim; the first-run tour starts only if the claim is won, and a claim that fails or
 * cannot be asked is a "no" (no browser-only fallback that could show it twice).
 */
export async function resolveTourStart(mode: TourStartMode, claim: () => Promise<boolean>): Promise<boolean> {
  if (mode === "replay") return true;
  if (mode !== "first-run") return false;
  try {
    return (await claim()) === true;
  } catch {
    return false;
  }
}
