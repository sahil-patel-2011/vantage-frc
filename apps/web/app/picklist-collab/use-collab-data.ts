"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PicklistCollabView } from "../../lib/picklist-collab/compute-picklist-collab";
import { confirmsCollabMutation, isCollabView, type CollabMutate } from "../../lib/picklist-collab/view-contract";
import { clearFeatureSnapshot, getFeatureSnapshot, putFeatureSnapshot } from "../../lib/offline/feature-cache";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";

export function useCollabData(requestedOrg: string | null) {
  const [view, setView] = useState<PicklistCollabView | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const viewRef = useRef(view); viewRef.current = view;
  const request = useRef<AbortController | null>(null);
  const writing = useRef(false);
  const generation = useRef(0);

  const persist = useCallback((data: PicklistCollabView) => {
    if (data.status !== "live") return;
    const variant = data.activeList?.id ?? "";
    void putFeatureSnapshot("picklist-collab", data.orgId, data, variant).catch(() => undefined);
    void putFeatureSnapshot("picklist-collab", data.orgId, data, "").catch(() => undefined);
    if (!requestedOrg) {
      void putFeatureSnapshot("picklist-collab", "_", data, variant).catch(() => undefined);
      void putFeatureSnapshot("picklist-collab", "_", data, "").catch(() => undefined);
    }
  }, [requestedOrg]);

  const deny = useCallback((targetList: string) => {
    viewRef.current = null; setView(null); setFromCache(false); setCachedAt(null); setFetchFailed(true);
    const scope = requestedOrg || "_";
    void clearFeatureSnapshot("picklist-collab", scope, targetList).catch(() => undefined);
    void clearFeatureSnapshot("picklist-collab", scope, "").catch(() => undefined);
  }, [requestedOrg]);

  const load = useCallback((listOverride?: string | null) => {
    if (writing.current) return;
    if (listOverride === null) {
      const url = new URL(window.location.href); url.searchParams.delete("listId");
      window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
    }
    const targetList = listOverride !== undefined ? listOverride ?? "" : viewRef.current?.status === "live"
      ? viewRef.current.activeList?.id ?? "" : new URLSearchParams(window.location.search).get("listId") ?? "";
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    const sequence = ++generation.current;
    const current = () => !controller.signal.aborted && sequence === generation.current;
    let liveAccepted = false;
    setRefreshing(true); setFetchFailed(false); setError(""); setNotice("");
    // Optional device storage never holds up the hosted read.
    void getFeatureSnapshot<PicklistCollabView>("picklist-collab", requestedOrg || "_", targetList).then(cached => {
      if (!current() || liveAccepted || viewRef.current || !cached || !isCollabView(cached.data, requestedOrg, targetList)) return;
      viewRef.current = cached.data; setView(cached.data); setFetchFailed(false); setFromCache(true); setCachedAt(cached.cachedAt);
    }).catch(() => undefined);
    void (async () => {
      const query = new URLSearchParams();
      if (requestedOrg) query.set("orgId", requestedOrg);
      if (targetList) query.set("listId", targetList);
      try {
        const response = await fetch(`/api/picklist-collab?${query}`, { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(FEATURE_API_TIMEOUT_MS)]) });
        const data = await response.json();
        if (!current()) return;
        if (response.status === 401 || response.status === 403) { liveAccepted = true; deny(targetList); setError(data?.error ?? "Your access changed. Sign in again or choose another team."); return; }
        if (!response.ok || !isCollabView(data, requestedOrg, targetList)) throw new Error(data?.error ?? "Could not refresh the pick list.");
        liveAccepted = true; viewRef.current = data; setView(data); setFromCache(false); setCachedAt(null); persist(data);
      } catch (failure) {
        if (!current()) return;
        setFetchFailed(!viewRef.current);
        setFromCache(Boolean(viewRef.current));
        const explanation = failure instanceof Error && !["AbortError", "TimeoutError", "TypeError"].includes(failure.name) ? failure.message : "Could not refresh the pick list.";
        setError(`${explanation}${viewRef.current ? " The previous list is still shown." : ""}`);
      } finally {
        if (current()) setRefreshing(false);
        if (request.current === controller) request.current = null;
      }
    })();
  }, [deny, persist, requestedOrg]);

  useEffect(() => { load(); return () => { generation.current++; request.current?.abort(); }; }, [load]);

  const mutate: CollabMutate = useCallback(async payload => {
    const before = viewRef.current;
    if (writing.current || !before?.orgId) return false;
    writing.current = true;
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    const sequence = ++generation.current;
    const current = () => !controller.signal.aborted && sequence === generation.current;
    const list = before.status === "live" ? before.activeList : null;
    setBusy(true); setRefreshing(false); setError(""); setNotice("");
    try {
      const response = await fetch("/api/picklist-collab", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...payload, orgId: before.orgId, listId: list?.id, expectedRevision: list?.revision }),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(FEATURE_API_TIMEOUT_MS)]),
      });
      const data = await response.json();
      if (!current()) return false;
      if (response.status === 401 || response.status === 403) { deny(list?.id ?? ""); setError(data?.error ?? "Your access changed. Sign in again."); return false; }
      if (!response.ok) { setError(data?.error ?? "Save was not confirmed. Your inputs are retained."); return false; }
      if (!isCollabView(data, before.orgId, payload.action === "create-list" ? null : list?.id) || data.status !== "live"
        || !confirmsCollabMutation(data, payload, before)) throw new Error("Save acknowledgement did not match");
      viewRef.current = data; setView(data); setFromCache(false); setCachedAt(null); persist(data);
      setNotice(payload.action === "create-list" ? "Pick list ready." : payload.action === "cast-vote" ? "Your vote saved." : payload.action === "remove-vote" ? "Your vote removed." : "Pick list updated.");
      return true;
    } catch {
      if (current()) setError("Could not confirm the change. Your inputs are retained. Refresh the saved list to check before retrying.");
      return false;
    } finally {
      writing.current = false;
      if (request.current === controller) request.current = null;
      if (current()) setBusy(false);
    }
  }, [deny, persist]);
  return { view, error, notice, fetchFailed, busy, refreshing, fromCache, cachedAt, load, mutate };
}
