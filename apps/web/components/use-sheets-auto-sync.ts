"use client";

import { useEffect } from "react";
import { hostedBackgroundWorkEnabled } from "../lib/hosted-background-work";

/** After a save, wait this long so a burst of edits becomes one refresh. */
export const AFTER_SAVE_DELAY_MS = 20_000;

const ENDPOINT = "/api/integrations/sheets/auto";

/** Only real changes to team data count: a write to an API route, not a read or this ping itself. */
export function isTeamDataWrite(method: string | undefined, url: string): boolean {
  const verb = (method ?? "GET").toUpperCase();
  if (verb === "GET" || verb === "HEAD" || verb === "OPTIONS") return false;
  let path: string;
  try {
    path = new URL(url, "http://local").pathname;
  } catch {
    return false;
  }
  if (!path.startsWith("/api/")) return false;
  return !(
    path.startsWith(ENDPOINT) ||
    path.startsWith("/api/auth/") ||
    path.startsWith("/api/integrations/mirror/") ||
    path.startsWith("/api/analytics") ||
    path.startsWith("/api/telemetry") ||
    path.startsWith("/api/presence")
  );
}

/**
 * Keep the team's spreadsheets following the app without a Sync button: ping on open, when
 * the tab comes back into view, and shortly after anything is saved. The server decides
 * whether anything changed (at most one run per team every 2 minutes).
 *
 * There is no timer. A tab left open used to ask for a full re-hash of the team's tables
 * every three minutes whether or not anyone had saved anything; a save in any tab already
 * triggers the refresh, and the daily sync catches whatever no tab was open for.
 */
export function useSheetsAutoSync(orgId: string): void {
  useEffect(() => {
    if (!hostedBackgroundWorkEnabled() || !orgId || typeof window === "undefined") return;
    let afterSave: ReturnType<typeof setTimeout> | null = null;

    const ping = () => {
      if (document.visibilityState !== "visible") return;
      void fetch(ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId }),
        keepalive: true,
      }).catch(() => undefined);
    };

    const originalFetch = window.fetch;
    const watchedFetch: typeof window.fetch = async (input, init) => {
      const response = await originalFetch(input, init);
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const method = init?.method ?? (input instanceof Request ? input.method : "GET");
      if (response.ok && isTeamDataWrite(method, url)) {
        if (afterSave) clearTimeout(afterSave);
        afterSave = setTimeout(ping, AFTER_SAVE_DELAY_MS);
      }
      return response;
    };
    window.fetch = watchedFetch;

    const first = setTimeout(ping, 5_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") ping();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      // Only put fetch back if nothing else wrapped it after us.
      if (window.fetch === watchedFetch) window.fetch = originalFetch;
      clearTimeout(first);
      if (afterSave) clearTimeout(afterSave);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [orgId]);
}
