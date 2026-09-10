"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getFeatureSnapshot, putFeatureSnapshot, type FeatureSnapshot, type OfflineFeature } from "./feature-cache";
import { useOnline } from "./use-online";

export type OfflineSnapshotState<T> = {
  data: T | null;
  cachedAt: string | null;
  offline: boolean;
  loading: boolean;
  refresh: () => Promise<void>;
};

/**
 * Last-good snapshot for a product page. Online: fetch and persist.
 * Offline: render the IndexedDB copy and a quiet "showing what you had at …" time.
 */
export function useOfflineSnapshot<T>(
  feature: OfflineFeature,
  orgId: string,
  fetcher: () => Promise<T>,
): OfflineSnapshotState<T> {
  const online = useOnline();
  const [data, setData] = useState<T | null>(null);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const refresh = useCallback(async () => {
    if (!orgId) {
      setLoading(false);
      return;
    }
    if (online) {
      try {
        const next = await fetcherRef.current();
        setData(next);
        const at = new Date().toISOString();
        setCachedAt(at);
        await putFeatureSnapshot(feature, orgId, next);
        setLoading(false);
        return;
      } catch {
        // Fall through to the last snapshot rather than a dead Retry.
      }
    }
    const row: FeatureSnapshot<T> | null = await getFeatureSnapshot<T>(feature, orgId);
    if (row) {
      setData(row.data);
      setCachedAt(row.cachedAt);
    }
    setLoading(false);
  }, [feature, online, orgId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { data, cachedAt, offline: !online, loading, refresh };
}

export function offlineBannerLabel(cachedAt: string | null, now = new Date()): string {
  if (!cachedAt) return "Offline — showing what was on this device last time.";
  const at = new Date(cachedAt);
  if (Number.isNaN(at.getTime())) return "Offline — showing what was on this device last time.";
  const sameDay = at.toDateString() === now.toDateString();
  const time = at.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return sameDay ? `Offline — showing what you had at ${time}` : `Offline — showing what you had on ${at.toLocaleDateString()}`;
}
