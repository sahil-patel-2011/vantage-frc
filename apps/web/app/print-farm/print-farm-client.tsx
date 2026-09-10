"use client";

// 3D Print Farm — deliberately small, honest, and MANUAL.
// Non-goals (also stated in migration 0473): no slicer integration, no G-code upload,
// no printer telemetry, no OctoPrint/Bambu/Prusa API. Printer status is human-reported
// and always shown with how long ago it was reported. Every derived number (ETA, bias,
// runway, failure rate) is null with a named reason below its sample threshold.

import { useCallback, useEffect, useState } from "react";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
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

export default function PrintFarmClient() {
  const [view, setView] = useState<PrintFarmView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setFetchFailed(false);
    setError("");
    const params = new URLSearchParams(window.location.search);
    const urlOrg = params.get("orgId");
    const query = new URLSearchParams();
    if (urlOrg) query.set("orgId", urlOrg);
    void fetch(`/api/print-farm${query.toString() ? `?${query.toString()}` : ""}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
    })
      .then(async (response) => {
        const data = (await response.json()) as PrintFarmView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setFetchFailed(true);
          return;
        }
        setView(data);
      })
      .catch(() => setFetchFailed(true));
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
        });
        const data = (await response.json()) as PrintFarmView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setError("error" in data && data.error ? data.error : "Something went wrong.");
          return;
        }
        setView(data);
      } catch {
        setError("Network error — please try again.");
      } finally {
        setBusy(false);
      }
    },
    [orgId, busy],
  );

  if (view == null && !fetchFailed) {
    return <FarmShell description="Queue prints, report printer status, and track filament by hand." kind="loading" />;
  }
  if (fetchFailed) {
    return (
      <FarmShell
        description="Queue prints, report printer status, and track filament by hand."
        orgId={orgId}
        kind="error"
        error="Could not load the Print Farm."
        onRetry={() => load()}
      />
    );
  }
  if (view == null || view.status !== "live") {
    return (
      <FarmShell
        description={view?.status === "setup_required" ? view.message : "Choose your team to run the print farm."}
        orgId={orgId}
        kind="setup"
      />
    );
  }

  return (
    <main className="module-page pf-page">
      <PrintFarmReadyHeader orgId={view.orgId} error={error} />
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
