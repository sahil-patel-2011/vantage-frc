"use client";

import { useEffect } from "react";

/** How often an open Vantage tab asks for a spreadsheet refresh. The server allows one per team every 2 minutes. */
export const AUTO_SYNC_INTERVAL_MS = 3 * 60_000;
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
 * Keep the team's spreadsheets following the app without a Sync button: ping on open, every
 * few minutes while the tab is visible, and shortly after anything is saved. The server
 * decides whether anything changed; a ping with nothing new costs one hash.
 */
export function useSheetsAutoSync(orgId: string): void {
  useEffect(() => {
    if (!orgId || typeof window === "undefined") return;
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
    const interval = setInterval(ping, AUTO_SYNC_INTERVAL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") ping();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      // Only put fetch back if nothing else wrapped it after us.
      if (window.fetch === watchedFetch) window.fetch = originalFetch;
      clearTimeout(first);
      clearInterval(interval);
      if (afterSave) clearTimeout(afterSave);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [orgId]);
}
