"use client";

import { retriesByItself, savedCopyBanner, type ScoutLoadFailure } from "../../lib/scouting/load-state";
import { signInHref } from "../../lib/ui/load-failure";

/**
 * The strip above a quick screen that is showing this phone's saved copy: why (no signal,
 * slow, server error, signed out, access changed), how old the copy is, and the one thing
 * that helps.
 */
export function SavedCopyBanner({
  failure,
  cachedAt,
  onRetry,
}: {
  failure: ScoutLoadFailure | null;
  cachedAt: string | null;
  onRetry(): void;
}) {
  if (!failure) return null;
  const here = typeof window === "undefined" ? null : `${window.location.pathname}${window.location.search}`;
  return (
    <p className="qs-offline" role="status">
      {savedCopyBanner(failure, cachedAt)}
      {failure === "signed-out" ? (
        <>
          {" "}
          <a href={signInHref(here)}>Sign in again</a>
        </>
      ) : retriesByItself(failure) ? (
        <>
          {" "}
          <button type="button" className="qs-inline-action" onClick={onRetry}>
            Try now
          </button>
        </>
      ) : null}
    </p>
  );
}
