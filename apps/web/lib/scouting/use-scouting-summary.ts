"use client";

import { useCallback, useEffect, useState } from "react";
import { getFeatureSnapshot, putFeatureSnapshot } from "../offline/feature-cache";
import { listPendingEntries } from "../scout-offline";
import { SCOUTING_LOAD_TIMEOUT_MS, SCOUTING_RETRY_MS } from "./load-state";
import type { LeadSummaryView } from "./lead-summary-load";
import { useScoutQueueRefresh } from "./use-queue-refresh";

export type ScoutingSummaryState = {
  view: LeadSummaryView | null;
  status: "loading" | "ready" | "failed";
  /** The copy saved on this phone, shown because the live one could not load. */
  cachedAt: string | null;
  reload(): void;
};

/**
 * The scouting summary, kept usable at a venue with no signal: the live numbers when they
 * load, else this phone's last copy. Pit reports still waiting in this phone's outbox count
 * as visited right away, so a scout never walks back to a pit they just saved.
 */
export function useScoutingSummary(orgId: string | null, initial: LeadSummaryView | null = null): ScoutingSummaryState {
  const [view, setView] = useState<LeadSummaryView | null>(initial);
  const [status, setStatus] = useState<"loading" | "ready" | "failed">(initial ? "ready" : "loading");
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const [pendingPits, setPendingPits] = useState<string[]>([]);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!orgId) return;
    let cancelled = false;
    setStatus((current) => (current === "ready" ? current : "loading"));
    void (async () => {
      try {
        const response = await fetch(`/api/scouting/summary?orgId=${encodeURIComponent(orgId)}`, {
          cache: "no-store",
          // The summary counts every report at the event; a busy venue network gets the
          // scouting wait, not the 8 seconds a small read gets.
          signal: AbortSignal.timeout(SCOUTING_LOAD_TIMEOUT_MS),
        });
        if (!response.ok) throw new Error(String(response.status));
        const body = (await response.json()) as LeadSummaryView;
        if (cancelled) return;
        setView(body);
        setCachedAt(null);
        setStatus("ready");
        void putFeatureSnapshot("scouting-summary", orgId, body).catch(() => undefined);
      } catch {
        const saved = await getFeatureSnapshot<LeadSummaryView>("scouting-summary", orgId).catch(() => null);
        if (cancelled) return;
        if (saved) {
          setView(saved.data);
          setCachedAt(saved.cachedAt);
          setStatus("ready");
        } else setStatus("failed");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [orgId, attempt]);

  const refreshPending = useCallback(async () => {
    if (!orgId) return;
    try {
      const entries = await listPendingEntries(orgId);
      setPendingPits(entries.filter((entry) => entry.type === "pit").map((entry) => entry.teamKey));
    } catch {
      setPendingPits([]);
    }
  }, [orgId]);
  useScoutQueueRefresh(refreshPending);

  const merged =
    view?.status === "ready" && pendingPits.length
      ? (() => {
          const done = new Set(pendingPits);
          const teams = view.pit.teams.map((team) => (done.has(team.teamKey) ? { ...team, visited: true } : team));
          const notVisited = teams.filter((team) => !team.visited).map(({ visited: _visited, ...team }) => team);
          return { ...view, pit: { ...view.pit, teams, notVisited, visited: view.pit.total - notVisited.length } };
        })()
      : view;

  // Showing this phone's copy, or nothing, because the live numbers failed: try again every
  // 30 seconds while the page is open (and the moment the phone is back online), instead of
  // waiting for the scout to find a reload.
  const stale = status === "failed" || cachedAt !== null;
  useEffect(() => {
    if (!orgId || !stale) return;
    const again = () => setAttempt((value) => value + 1);
    window.addEventListener("online", again);
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "hidden" && navigator.onLine !== false) again();
    }, SCOUTING_RETRY_MS);
    return () => {
      window.removeEventListener("online", again);
      window.clearInterval(timer);
    };
  }, [orgId, stale]);

  const reload = useCallback(() => setAttempt((value) => value + 1), []);
  return { view: merged, status, cachedAt, reload };
}
