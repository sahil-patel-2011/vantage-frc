"use client";

import { useEffect, useState } from "react";
import { bootstrapForEvent, scoutingBootstrapUrl } from "../../lib/scouting/bootstrap-event";
import { cacheEvent, getCachedEvent } from "../../lib/scout-offline";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import type { Bootstrap } from "../scouting/scouting-model";

/**
 * The event, forms, schedule and your reports the scouting screens run on: live when the
 * signal allows, else the copy this phone saved the last time it was online.
 */
export function useScoutingBootstrap(orgId: string, requestedEventKey: string | null) {
  const [data, setData] = useState<Bootstrap | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "failed">("loading");
  const [fromCache, setFromCache] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setStatus((current) => (current === "ready" ? current : "loading"));
    void (async () => {
      try {
        const response = await fetch(scoutingBootstrapUrl(orgId, requestedEventKey), {
          cache: "no-store",
          signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
        });
        if (!response.ok) throw new Error(String(response.status));
        const body = bootstrapForEvent((await response.json()) as Bootstrap, requestedEventKey);
        if (!body) throw new Error("event");
        if (cancelled) return;
        setData(body);
        setFromCache(false);
        setStatus("ready");
        void cacheEvent(orgId, body).catch(() => undefined);
      } catch {
        const cached = bootstrapForEvent(await getCachedEvent<Bootstrap>(orgId).catch(() => null), requestedEventKey);
        if (cancelled) return;
        if (cached) {
          setData(cached);
          setFromCache(true);
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

  return {
    data,
    status,
    fromCache,
    retry: () => setAttempt((value) => value + 1),
    /** After the starter forms are created the server returns the new bootstrap. */
    replace: (next: Bootstrap) => {
      setData(next);
      setFromCache(false);
      setStatus("ready");
    },
  };
}

/** Change the address without a router navigation, which would need the server (and fail offline). */
export function replaceQuery(pathname: string, changes: Record<string, string | null>) {
  const query = new URLSearchParams(window.location.search);
  for (const [key, value] of Object.entries(changes)) {
    if (value) query.set(key, value);
    else query.delete(key);
  }
  window.history.replaceState(window.history.state, "", `${pathname}?${query.toString()}`);
  window.scrollTo({ top: 0 });
}
