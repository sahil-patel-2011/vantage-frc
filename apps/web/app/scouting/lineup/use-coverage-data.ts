"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { clearFeatureSnapshot, getFeatureSnapshot, putFeatureSnapshot } from "../../../lib/offline/feature-cache";
import { FEATURE_API_TIMEOUT_MS } from "../../../lib/nav/resolve-org";
import type { ScoutingCoverageView } from "../../../lib/scouting/coverage";
import { assignmentResult, isCoverageView } from "../../../lib/scouting/coverage-view-contract";
import type { CoverageCommand } from "../../../lib/scouting/coverage-request";

export function useCoverageData(orgId: string, eventKey: string | undefined, qualsOnly: boolean, focusMatch: string) {
  const [view, setView] = useState<ScoutingCoverageView | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [failureStatus, setFailureStatus] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const current = useRef(view);
  current.current = view;
  const generation = useRef(0);
  const writing = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const cacheKey = `${eventKey ?? "active"}:${qualsOnly ? "quals" : "all"}:${focusMatch}`;
  const reading = useRef(false);
  const load = useCallback(async () => {
    if (writing.current) return;
    controller.current?.abort();
    const abort = new AbortController();
    reading.current = true;
    controller.current = abort;
    const id = ++generation.current;
    const valid = () => mounted.current && id === generation.current && !abort.signal.aborted;
    const scope = { orgId, eventKey, qualsOnly };
    // Keep this event's mounted editors during filter refreshes so entered ranges survive.
    // Requests and successful replies still require the exact selected filters.
    if (current.current && (current.current.orgId !== orgId || (eventKey && current.current.status === "live" && current.current.eventKey !== eventKey))) {
      current.current = null;
      setView(null);
    }
    let cacheAllowed = true;
    let hadView = Boolean(current.current);
    setRefreshing(true);
    setNotice("");
    // Device storage never delays the live request. Cached copies are always read-only.
    void getFeatureSnapshot<ScoutingCoverageView>("lineup", orgId, cacheKey).then(cached => {
      if (!valid() || !cacheAllowed || current.current || !cached || !isCoverageView(cached.data, scope)) return;
      hadView = true;
      current.current = cached.data;
      setView(cached.data);
      setFromCache(true);
      setCachedAt(cached.cachedAt);
      setFetchFailed(false);
    }).catch(() => {});
    const params = new URLSearchParams({ orgId, window: "4", qualsOnly: qualsOnly ? "1" : "0" });
    if (eventKey) params.set("eventKey", eventKey);
    if (focusMatch) params.set("matchKey", focusMatch);
    try {
      const response = await fetch(`/api/scouting/coverage?${params}`, { cache: "no-store", signal: AbortSignal.any([abort.signal, AbortSignal.timeout(FEATURE_API_TIMEOUT_MS)]) });
      const data: unknown = await response.json().catch(() => null);
      if (!valid()) return;
      if (!response.ok) {
        const message = data && typeof data === "object" && "error" in data && typeof data.error === "string" ? data.error : "Could not refresh assignments.";
        if (response.status === 401 || response.status === 403) {
          cacheAllowed = false;
          void clearFeatureSnapshot("lineup", orgId, cacheKey).catch(() => {});
          setView(null);
          current.current = null;
          setFromCache(false);
          setCachedAt(null);
          setFetchFailed(true);
        } else { setFromCache(hadView); setFetchFailed(!hadView); }
        setFailureStatus(response.status);
        setError(message);
        return;
      }
      if (!isCoverageView(data, scope)) throw new Error("Unexpected coverage response");
      cacheAllowed = false;
      current.current = data;
      setView(data);
      setError("");
      setFailureStatus(null);
      setFetchFailed(false);
      setFromCache(false);
      setCachedAt(null);
      void putFeatureSnapshot("lineup", orgId, data, cacheKey).catch(() => {});
    } catch {
      if (!valid()) return;
      setFromCache(hadView);
      setFetchFailed(!hadView);
      setError(hadView ? "Showing the last copy on this device. Refresh before changing assignments." : "Assignments could not be loaded. Check your connection and refresh.");
    } finally { if (valid()) { reading.current = false; setRefreshing(false); } }
  }, [cacheKey, eventKey, focusMatch, orgId, qualsOnly]);

  const mutate = useCallback(async (body: CoverageCommand) => {
    const before = current.current;
    if (writing.current || reading.current || refreshing || fromCache || before?.status !== "live") return;
    writing.current = true;
    controller.current?.abort();
    const id = ++generation.current;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/scouting/coverage", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...body, orgId, eventKey: before.eventKey, qualsOnly, ...(focusMatch ? { focusMatchKey: focusMatch } : {}) }), signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS) });
      const data: unknown = await response.json().catch(() => null);
      if (!mounted.current || id !== generation.current) return;
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          setView(null); current.current = null; setFetchFailed(true); setFailureStatus(response.status);
          setFromCache(false); setCachedAt(null);
          void clearFeatureSnapshot("lineup", orgId, cacheKey).catch(() => {});
        } else { setFromCache(true); }
        const message = data && typeof data === "object" && "error" in data && typeof data.error === "string" ? data.error : "Could not save assignments. Refresh to check the saved result before retrying.";
        setError(message);
        return;
      }
      if (!isCoverageView(data, { orgId, eventKey: before.eventKey, qualsOnly }) || data.status !== "live") throw new Error("Unconfirmed assignment view");
      const result = assignmentResult("assignmentResult" in data ? data.assignmentResult : null, body.action);
      if (!result) throw new Error("Unconfirmed assignment result");
      current.current = data;
      setView(data);
      setFromCache(false);
      setCachedAt(null);
      setNotice(`${result.assigned} ${body.action === "swap" ? "reassigned" : "new assignments saved"}${result.unchanged ? ` · ${result.unchanged} already assigned` : ""}${result.refused.length ? ` · ${result.refused.length} items need attention` : ""}.`);
      setError(result.refused.join(" "));
      void putFeatureSnapshot("lineup", orgId, data, cacheKey).catch(() => {});
    } catch {
      if (!mounted.current || id !== generation.current) return;
      setFromCache(true);
      setError("The saved result could not be confirmed. Refresh before retrying; the server may have received your change.");
    } finally { writing.current = false; if (mounted.current && id === generation.current) setBusy(false); }
  }, [cacheKey, focusMatch, fromCache, orgId, qualsOnly, refreshing]);

  useEffect(() => { void load(); return () => { ++generation.current; controller.current?.abort(); }; }, [load]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; ++generation.current; controller.current?.abort(); }; }, []);
  return { view, error, notice, fetchFailed, failureStatus, busy, fromCache, cachedAt, refreshing, load, mutate };
}
