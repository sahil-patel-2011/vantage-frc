"use client";

// 3D Print Farm — deliberately small, honest, and MANUAL.
// Non-goals (also stated in migration 0473): no slicer integration, no G-code upload,
// no printer telemetry, no OctoPrint/Bambu/Prusa API. Printer status is human-reported
// and always shown with how long ago it was reported. Every derived number (ETA, bias,
// runway, failure rate) is null with a named reason below its sample threshold.

import { useCallback, useEffect, useRef, useState } from "react";
import { OfflineBanner } from "../../components/offline-banner";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../lib/offline/feature-cache";
import type { PrintFarmView } from "../../lib/print-farm/compute-print-farm";
import {
  FarmShell,
  NonGoalsNote,
  PrintFarmReadyHeader,
  PrintFarmSummaryPanel,
} from "./print-farm-chrome";
import { FilamentPanel } from "./print-farm-filament";
import { RecentFinishedPanel } from "./print-farm-finished";
import {
  printFarmHasAnything,
  printFarmOrgId,
  type Mutate,
} from "./print-farm-model";
import { PrintersPanel } from "./print-farm-printers";
import { QueueJobForm, QueuePanel } from "./print-farm-queue";
import "./print-farm.css";

function isPrintFarmView(value: unknown): value is PrintFarmView {
  if (!value || typeof value !== "object") return false;
  const status = (value as { status?: unknown }).status;
  return status === "setup_required" || status === "live";
}

async function persistPrintFarmSnapshot(orgHint: string, data: PrintFarmView): Promise<void> {
  const cacheOrg = printFarmOrgId(data) || orgHint;
  if (!cacheOrg) return;
  try {
    await putFeatureSnapshot("print-farm", cacheOrg, data);
    if (!orgHint) await putFeatureSnapshot("print-farm", "_", data);
  } catch {
    // Live farm already painted; IndexedDB is best-effort.
  }
}

export default function PrintFarmClient() {
  const [view, setView] = useState<PrintFarmView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const viewRef = useRef<PrintFarmView | null>(null);
  viewRef.current = view;

  const load = useCallback(() => {
    void (async () => {
      const params = new URLSearchParams(window.location.search);
      const urlOrg = params.get("orgId")?.trim() ?? "";
      let hadCache = Boolean(viewRef.current);
      try {
        const cached = await getFeatureSnapshot<PrintFarmView>("print-farm", urlOrg || "_");
        if (!viewRef.current && cached?.data && isPrintFarmView(cached.data)) {
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
      const query = new URLSearchParams();
      if (urlOrg) query.set("orgId", urlOrg);
      try {
        const response = await fetch(`/api/print-farm${query.toString() ? `?${query.toString()}` : ""}`, {
          cache: "no-store",
          signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
        });
        const data = (await response.json()) as PrintFarmView | { error?: string };
        if (!response.ok || !isPrintFarmView(data)) {
          if (hadCache || viewRef.current) {
            setFromCache(true);
            setError("Could not refresh Print Farm. Showing the last copy on this device.");
            setFetchFailed(false);
          } else {
            setFetchFailed(true);
          }
          return;
        }
        setView(data);
        setFromCache(false);
        setCachedAt(null);
        await persistPrintFarmSnapshot(urlOrg, data);
      } catch {
        if (hadCache || viewRef.current) {
          setFromCache(true);
          setError("Could not refresh Print Farm. Showing the last copy on this device.");
          setFetchFailed(false);
        } else {
          setFetchFailed(true);
        }
      }
    })();
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const orgId = printFarmOrgId(view);

  const mutate = useCallback<Mutate>(
    async (payload) => {
      if (!orgId || busy) return;
      setBusy(true);
      setError("");
      try {
        const response = await fetch("/api/print-farm", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, ...payload }),
          signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
        });
        const data = (await response.json()) as PrintFarmView | { error?: string };
        if (!response.ok || !isPrintFarmView(data)) {
          setError("error" in data && data.error ? data.error : "Something went wrong.");
          return;
        }
        setView(data);
        void persistPrintFarmSnapshot(orgId, data);
      } catch {
        setError("Network error — please try again.");
      } finally {
        setBusy(false);
      }
    },
    [orgId, busy],
  );

  const banner = (
    <OfflineBanner feature="Print Farm" fromCache={fromCache} cachedAt={cachedAt} />
  );

  if (view == null && !fetchFailed) {
    return (
      <FarmShell description="Queue prints, report printer status, and track filament by hand." kind="loading">
        {banner}
      </FarmShell>
    );
  }
  if (fetchFailed) {
    return (
      <FarmShell
        description="Queue prints, report printer status, and track filament by hand."
        orgId={orgId}
        kind="error"
        error="Could not load the Print Farm."
        onRetry={() => load()}
      >
        {banner}
      </FarmShell>
    );
  }
  if (view == null || view.status !== "live") {
    return (
      <FarmShell
        description={view?.status === "setup_required" ? view.message : "Choose your team to run the print farm."}
        orgId={orgId}
        kind="setup"
      >
        {banner}
      </FarmShell>
    );
  }

  return (
    <main className="module-page pf-page">
      <PrintFarmReadyHeader orgId={view.orgId} error={error} />
      {banner}
      {printFarmHasAnything(view) ? <PrintFarmSummaryPanel view={view} /> : null}
      <QueueJobForm view={view} busy={busy} mutate={mutate} />
      <QueuePanel view={view} busy={busy} mutate={mutate} />
      <PrintersPanel view={view} busy={busy} mutate={mutate} />
      <FilamentPanel view={view} busy={busy} mutate={mutate} />
      <RecentFinishedPanel view={view} />
      <NonGoalsNote />
    </main>
  );
}
