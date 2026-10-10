"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { clearFeatureSnapshot, getFeatureSnapshot, putFeatureSnapshot } from "../../lib/offline/feature-cache";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import type { ScoutCoverageLiveView } from "../../lib/scout-coverage-live/compute-scout-coverage-live";
import type { ReviewCommand } from "../../lib/scout-coverage-live/request";
import { confirmedReviewResult, isReviewView } from "../../lib/scout-coverage-live/view-contract";

function errorMessage(value: unknown, fallback: string) {
  return value && typeof value === "object" && "error" in value && typeof value.error === "string" ? value.error : fallback;
}
export function useReviewData(orgId: string, eventKey?: string) {
  const [view, setView] = useState<ScoutCoverageLiveView | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [failureStatus, setFailureStatus] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const current = useRef(view);
  current.current = view;
  const reading = useRef(false);
  const writing = useRef(false);
  const writable = useRef(false);
  const generation = useRef(0);
  const mounted = useRef(true);
  const controller = useRef<AbortController | null>(null);
  const variant = eventKey ?? "active";
  const load = useCallback(async () => {
    if (writing.current) return;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    const id = ++generation.current;
    const valid = () => mounted.current && id === generation.current && !abort.signal.aborted;
    reading.current = true;
    writable.current = false;
    setRefreshing(true);
    setNotice("");
    setFailureStatus(null);
    let cacheAllowed = true;
    let hadView = Boolean(current.current);
    void getFeatureSnapshot<ScoutCoverageLiveView>("scout-coverage-live", orgId, variant).then(cached => {
      if (!valid() || !cacheAllowed || current.current || !cached || !isReviewView(cached.data, orgId, eventKey)) return;
      hadView = true;
      current.current = cached.data;
      setView(cached.data);
      setFromCache(true);
      setCachedAt(cached.cachedAt);
      setFetchFailed(false);
    }).catch(() => {});
    const query = new URLSearchParams({ orgId });
    if (eventKey) query.set("eventKey", eventKey);
    try {
      const response = await fetch(`/api/scout-coverage-live?${query}`, { cache: "no-store", signal: AbortSignal.any([abort.signal, AbortSignal.timeout(FEATURE_API_TIMEOUT_MS)]) });
      const data: unknown = await response.json().catch(() => null);
      if (!valid()) return;
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          cacheAllowed = false;
          current.current = null;
          setView(null); setFromCache(false); setCachedAt(null); setFetchFailed(true);
          void clearFeatureSnapshot("scout-coverage-live", orgId, variant).catch(() => {});
        } else { setFromCache(hadView); setFetchFailed(!hadView); }
        setFailureStatus(response.status);
        setError(errorMessage(data, "Could not refresh coverage review."));
        return;
      }
      if (!isReviewView(data, orgId, eventKey)) throw new Error("Unexpected coverage review response");
      cacheAllowed = false;
      current.current = data;
      writable.current = true;
      setView(data); setFromCache(false); setCachedAt(null); setFetchFailed(false); setFailureStatus(null); setError("");
      void putFeatureSnapshot("scout-coverage-live", orgId, data, variant).catch(() => {});
    } catch {
      if (!valid()) return;
      setFromCache(hadView); setFetchFailed(!hadView);
      setError(hadView ? "Showing the last copy on this device. Refresh before changing flags or the report target." : "Coverage review could not be loaded. Check your connection and refresh.");
    } finally { if (valid()) { reading.current = false; setRefreshing(false); } }
  }, [eventKey, orgId, variant]);

  const mutate = useCallback(async (command: ReviewCommand): Promise<boolean> => {
    const before = current.current;
    if (writing.current || reading.current || !writable.current || before?.status !== "live") return false;
    writing.current = true;
    writable.current = false;
    controller.current?.abort();
    const id = ++generation.current;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/scout-coverage-live", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...command, orgId, eventKey: before.eventKey }), signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS) });
      const data: unknown = await response.json().catch(() => null);
      if (!mounted.current || id !== generation.current) return false;
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          current.current = null; setView(null); setFetchFailed(true); setFailureStatus(response.status); setFromCache(false); setCachedAt(null);
          void clearFeatureSnapshot("scout-coverage-live", orgId, variant).catch(() => {});
        } else { setFromCache(true); }
        setError(errorMessage(data, "Could not confirm the change. Refresh before retrying."));
        return false;
      }
      if (!isReviewView(data, orgId, before.eventKey) || data.status !== "live") throw new Error("Unconfirmed review view");
      const result = confirmedReviewResult("coverageResult" in data ? data.coverageResult : null, command);
      if (!result || (result.action === "set-threshold" && data.thinThreshold !== result.thinThreshold)) throw new Error("Unconfirmed review result");
      writable.current = true;
      current.current = data;
      setView(data); setFromCache(false); setCachedAt(null);
      setNotice(result.action === "set-threshold" ? `Report target saved: ${result.thinThreshold} per robot.` : result.action === "acknowledge-nudge" ? "Flag marked reviewed." : result.created ? "Flag saved to your team's coverage review." : "This robot already has an outstanding flag. Its original message has been kept.");
      void putFeatureSnapshot("scout-coverage-live", orgId, data, variant).catch(() => {});
      return true;
    } catch {
      if (mounted.current && id === generation.current) {
        setFromCache(true);
        setError("The saved result could not be confirmed. Refresh before retrying; the server may have received your change.");
      }
      return false;
    } finally { writing.current = false; if (mounted.current && id === generation.current) setBusy(false); }
  }, [orgId, variant]);
  useEffect(() => { mounted.current = true; void load(); return () => { mounted.current = false; ++generation.current; controller.current?.abort(); }; }, [load]);
  return { view, error, notice, fetchFailed, failureStatus, busy, refreshing, fromCache, cachedAt, load, mutate };
}
