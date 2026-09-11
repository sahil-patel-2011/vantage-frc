"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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

function isBuildHoursView(value: unknown): value is BuildHoursView {
  if (!value || typeof value !== "object") return false;
  const status = (value as { status?: unknown }).status;
  return status === "setup_required" || status === "ready";
}

function hoursCacheOrg(data: BuildHoursView, orgHint: string): string {
  const fromContext = data.context.orgId?.trim();
  if (fromContext) return fromContext;
  return orgHint;
}

async function persistHoursSnapshot(orgHint: string, data: BuildHoursView): Promise<void> {
  const cacheOrg = hoursCacheOrg(data, orgHint);
  if (!cacheOrg) return;
  try {
    await putFeatureSnapshot("hours", cacheOrg, data);
    if (!orgHint) await putFeatureSnapshot("hours", "_", data);
  } catch {
    // Live Hours already painted; IndexedDB is best-effort.
  }
}

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
  const viewRef = useRef<BuildHoursView | null>(null);
  viewRef.current = view;

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const load = useCallback(async () => {
    const params = new URLSearchParams(window.location.search);
    const orgHint = params.get("orgId")?.trim() ?? "";
    let hadCache = Boolean(viewRef.current);
    try {
      const cached = await getFeatureSnapshot<BuildHoursView>("hours", orgHint || "_");
      if (!viewRef.current && cached?.data && isBuildHoursView(cached.data)) {
        setView(cached.data);
        setFromCache(true);
        setCachedAt(cached.cachedAt);
        hadCache = true;
      }
    } catch {
      // IndexedDB missing or blocked; live fetch still runs.
    }
    setFetchFailed(false);
    setError("");
    setErrorStatus(null);
    try {
      const response = await fetch(`/api/hours${orgHint ? `?orgId=${encodeURIComponent(orgHint)}` : ""}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
      });
      const data: unknown = await response.json().catch(() => null);
      if (response.status === 401 || response.status === 403) {
        setView(null);
        setFromCache(false);
        setCachedAt(null);
        setFetchFailed(true);
        setErrorStatus(response.status);
        setError(
          data && typeof data === "object" && "error" in data && typeof data.error === "string"
            ? data.error
            : "",
        );
        return;
      }
      if (!response.ok || !isBuildHoursView(data)) {
        if (hadCache || viewRef.current) {
          setFromCache(true);
          setError("Could not refresh Hours. Showing the last copy on this device.");
          setFetchFailed(false);
          return;
        }
        setFetchFailed(true);
        setErrorStatus(response.status);
        setError(
          data && typeof data === "object" && "error" in data && typeof data.error === "string"
            ? data.error
            : "Could not load shop hours.",
        );
        return;
      }
      setError("");
      setView(data);
      setFromCache(false);
      setCachedAt(null);
      setNow(Date.now());
      await persistHoursSnapshot(orgHint, data);
    } catch {
      if (hadCache || viewRef.current) {
        setFromCache(true);
        setError("Could not refresh Hours. Showing the last copy on this device.");
        setFetchFailed(false);
        return;
      }
      setFetchFailed(true);
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

  if (!view) {
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
    return (
      <HoursLoadShell
        failure={failure}
        onRetry={() => void load()}
        fromCache={fromCache}
        cachedAt={cachedAt}
      />
    );
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
