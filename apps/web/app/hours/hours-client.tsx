"use client";

import { useCallback, useEffect, useState } from "react";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import {
  type BuildHoursView,
  type HourKind,
} from "../../lib/build-hours";
import {
  offlineQueueSupported,
  pendingClockCount,
  syncClockOutbox,
} from "../../lib/hours/kiosk-offline";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";
import {
  QUEUED_ON_DEVICE,
  getFeatureSnapshot,
  isBrowserOffline,
  putFeatureSnapshot,
  queueProductWrite,
  syncOutbox,
} from "../../lib/offline";
import { HoursLoadShell, HoursSetupShell } from "./hours-chrome";
import { HoursReadyView } from "./hours-ready-view";
import type { ActionBody } from "./hours-model";
import "./hours.css";

export default function HoursClient() {
  const [view, setView] = useState<BuildHoursView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [kind, setKind] = useState<HourKind>("build");
  const [now, setNow] = useState(() => Date.now());
  const [pending, setPending] = useState(0);
  const [online, setOnline] = useState(true);
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const load = useCallback(async () => {
    setFetchFailed(false);
    setErrorStatus(null);
    const params = new URLSearchParams(window.location.search);
    const orgId = params.get("orgId") ?? "";
    const cached = orgId ? await getFeatureSnapshot<BuildHoursView>("hours", orgId) : null;
    if (cached?.data) {
      setView(cached.data);
      setFromCache(true);
      setCachedAt(cached.cachedAt);
    }
    try {
      const response = await fetch(`/api/hours${orgId ? `?orgId=${encodeURIComponent(orgId)}` : ""}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
      });
      const data = (await response.json()) as BuildHoursView | { error?: string };
      if (!response.ok || !("status" in data)) {
        setError("error" in data && data.error ? data.error : "Could not load shop hours.");
        setErrorStatus(response.status);
        if (!cached) setFetchFailed(true);
        return;
      }
      setError("");
      setView(data);
      setFromCache(false);
      setCachedAt(null);
      setNow(Date.now());
      const cacheOrg = data.status === "ready" ? data.context.orgId || orgId : orgId;
      if (cacheOrg) await putFeatureSnapshot("hours", cacheOrg, data);
    } catch {
      if (!cached) setFetchFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const run = useCallback(
    async (body: ActionBody, key: string) => {
      if (isBrowserOffline() && (body.action === "clock_in" || body.action === "clock_out") && body.orgId) {
        await queueProductWrite({
          feature: "hours_clock",
          orgId: body.orgId,
          payload: body,
        });
        setError(QUEUED_ON_DEVICE);
        return true;
      }
      setBusyKey(key);
      setError("");
      try {
        const response = await fetch("/api/hours", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
        });
        const data = (await response.json()) as { error?: string };
        if (!response.ok) {
          setError(data.error ?? "Action failed.");
          return false;
        }
        await load();
        return true;
      } catch {
        setError("Network error — changes were not saved.");
        return false;
      } finally {
        setBusyKey(null);
      }
    },
    [load],
  );

  const orgIdForQueue = view?.status === "ready" ? view.context.orgId ?? "" : "";

  const refreshPending = useCallback(async () => {
    if (!offlineQueueSupported()) return;
    try {
      setPending(await pendingClockCount(orgIdForQueue || undefined));
    } catch {
      /* locked-down browser without IndexedDB just shows 0 */
    }
  }, [orgIdForQueue]);

  const drain = useCallback(async () => {
    if (!orgIdForQueue) return;
    try {
      let reload = false;
      if (offlineQueueSupported()) {
        const result = await syncClockOutbox(orgIdForQueue);
        setPending(result.remaining);
        if (result.synced > 0) {
          setError(`Synced ${result.synced} queued scan${result.synced === 1 ? "" : "s"}.`);
          reload = true;
        } else if (result.rejected.length) {
          setError(result.rejected[0]!.reason);
        }
      }
      const product = await syncOutbox({ orgId: orgIdForQueue });
      if (product.synced > 0) reload = true;
      if (reload) await load();
    } catch {
      /* still offline — the queue stays put */
    }
  }, [load, orgIdForQueue]);

  useEffect(() => {
    const update = () => {
      const isOnline = typeof navigator === "undefined" ? true : navigator.onLine !== false;
      setOnline(isOnline);
      if (isOnline) void drain();
    };
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, [drain]);

  useEffect(() => {
    void refreshPending();
  }, [refreshPending]);

  if (fetchFailed || !view) {
    const failure = fetchFailed
      ? loadFailureCopy(
          classifyLoadFailure({
            status: errorStatus,
            message: error,
            online: typeof navigator === "undefined" ? true : navigator.onLine,
          }),
          {
            nextPath:
              typeof window === "undefined"
                ? null
                : `${window.location.pathname}${window.location.search}`,
            message: error || "Check your connection and try again.",
          },
        )
      : null;
    return <HoursLoadShell failure={failure} onRetry={() => void load()} />;
  }

  if (view.status === "setup_required") {
    return (
      <HoursSetupShell
        message={view.message}
        fromCache={fromCache}
        cachedAt={cachedAt}
      />
    );
  }

  return (
    <HoursReadyView
      view={view}
      now={now}
      busyKey={busyKey}
      error={error}
      fromCache={fromCache}
      cachedAt={cachedAt}
      pending={pending}
      online={online}
      kind={kind}
      setKind={setKind}
      setBusyKey={setBusyKey}
      setError={setError}
      run={run}
      drain={drain}
      load={load}
      refreshPending={refreshPending}
    />
  );
}
