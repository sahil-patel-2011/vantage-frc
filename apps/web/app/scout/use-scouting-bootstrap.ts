"use client";

import { useEffect, useState } from "react";
import { bootstrapForEvent, scoutingBootstrapUrl } from "../../lib/scouting/bootstrap-event";
import { cacheEvent, getCachedEventRecord } from "../../lib/scout-offline";
import {
  SCOUTING_LOAD_TIMEOUT_MS,
  SCOUTING_RETRY_MS,
  classifyScoutLoadFailure,
  retriesByItself,
  type ScoutLoadFailure,
} from "../../lib/scouting/load-state";
import type { Bootstrap } from "../scouting/scouting-model";

class BootstrapHttpError extends Error {
  constructor(readonly status: number) {
    super(String(status));
  }
}

/**
 * The event, forms, schedule and your reports the scouting screens run on: live when the
 * signal allows, else the copy this phone saved the last time it was online. When the live
 * copy fails, `failure` says why (no signal, slow, signed out, no access, server error) so the
 * page does not call every failure "offline", and a failure that can pass by itself is tried
 * again every 30 seconds while the saved copy stays on screen.
 */
export function useScoutingBootstrap(orgId: string, requestedEventKey: string | null) {
  const [data, setData] = useState<Bootstrap | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "failed">("loading");
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const [failure, setFailure] = useState<ScoutLoadFailure | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setStatus((current) => (current === "ready" ? current : "loading"));
    void (async () => {
      try {
        const response = await fetch(scoutingBootstrapUrl(orgId, requestedEventKey), {
          cache: "no-store",
          signal: AbortSignal.timeout(SCOUTING_LOAD_TIMEOUT_MS),
        });
        if (!response.ok) throw new BootstrapHttpError(response.status);
        const body = bootstrapForEvent((await response.json()) as Bootstrap, requestedEventKey);
        if (!body) throw new Error("event");
        if (cancelled) return;
        setData(body);
        setFromCache(false);
        setCachedAt(null);
        setFailure(null);
        setStatus("ready");
        void cacheEvent(orgId, body).catch(() => undefined);
      } catch (error) {
        const kind = classifyScoutLoadFailure({
          online: typeof navigator === "undefined" ? true : navigator.onLine !== false,
          status: error instanceof BootstrapHttpError ? error.status : null,
          timedOut: error instanceof DOMException && error.name === "TimeoutError",
        });
        const cached = await getCachedEventRecord<Bootstrap>(orgId).catch(() => null);
        const copy = bootstrapForEvent(cached?.data ?? null, requestedEventKey);
        if (cancelled) return;
        setFailure(kind);
        if (copy) {
          setData(copy);
          setFromCache(true);
          setCachedAt(cached?.cachedAt ?? null);
          setStatus("ready");
        } else {
          setStatus("failed");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [orgId, requestedEventKey, attempt]);

  // Showing the saved copy because the network was slow or the server failed: keep trying.
  // No signal: try the moment the phone says it is back.
  useEffect(() => {
    if (!failure) return;
    const again = () => setAttempt((value) => value + 1);
    window.addEventListener("online", again);
    const timer = retriesByItself(failure) ? window.setInterval(() => {
      if (document.visibilityState !== "hidden" && navigator.onLine !== false) again();
    }, SCOUTING_RETRY_MS) : undefined;
    return () => {
      window.removeEventListener("online", again);
      if (timer !== undefined) window.clearInterval(timer);
    };
  }, [failure]);

  return {
    data,
    status,
    fromCache,
    cachedAt,
    /** Why the live copy did not load; null once it has. */
    failure,
    retry: () => setAttempt((value) => value + 1),
    /** After the starter forms are created the server returns the new bootstrap. */
    replace: (next: Bootstrap) => {
      setData(next);
      setFromCache(false);
      setCachedAt(null);
      setFailure(null);
      setStatus("ready");
    },
  };
}

function withQuery(pathname: string, changes: Record<string, string | null>): string {
  const query = new URLSearchParams(window.location.search);
  for (const [key, value] of Object.entries(changes)) {
    if (value) query.set(key, value);
    else query.delete(key);
  }
  return `${pathname}?${query.toString()}`;
}

/** Change the address without a router navigation, which would need the server (and fail offline). */
export function replaceQuery(pathname: string, changes: Record<string, string | null>) {
  window.history.replaceState(window.history.state, "", withQuery(pathname, changes));
  window.scrollTo({ top: 0 });
}

/** Marks a history entry this page pushed for an open robot or pit, so closing it can go back. */
const OPENED = "vantageScoutOpened";

/**
 * Open a robot or a pit as its own history entry, so the phone's Back button returns to the
 * list instead of leaving Scouting (the address used to be replaced, so Back skipped the list).
 * Still no router navigation: nothing is asked of the server.
 */
export function pushQuery(pathname: string, changes: Record<string, string | null>) {
  const state = window.history.state && typeof window.history.state === "object" ? window.history.state : {};
  window.history.pushState({ ...state, [OPENED]: true }, "", withQuery(pathname, changes));
  window.scrollTo({ top: 0 });
}

/**
 * Back to the list. When this page opened the robot, step back through history so Back and
 * "Change robot" leave the same trail; a robot opened from a link has nothing to go back to,
 * so its address is replaced.
 */
export function closeQuery(pathname: string, changes: Record<string, string | null>) {
  const state = window.history.state as Record<string, unknown> | null;
  if (state && state[OPENED] === true) window.history.back();
  else replaceQuery(pathname, changes);
}

/** Back and Forward between the list and an open robot: read the address again. */
export function useQueryPopState(onChange: (query: URLSearchParams) => void) {
  useEffect(() => {
    const listener = () => onChange(new URLSearchParams(window.location.search));
    window.addEventListener("popstate", listener);
    return () => window.removeEventListener("popstate", listener);
  }, [onChange]);
}
