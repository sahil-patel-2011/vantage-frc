"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { OfflineBanner } from "../../components/offline-banner";
import { EmptyState, PageHeader, Button } from "../../components/ui";
import type { OvernightIntelView } from "../../lib/overnight-intel/compute-overnight-intel";
import {
  classifyOvernightIntelShell,
  overnightIntelNextActions,
  overnightIntelShellCopy,
  overnightIntelSignalCount,
} from "../../lib/overnight-intel/overnight-intel-related";
import { hubHref, hubWorkbenchHref } from "../../lib/nav/hubs";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../lib/offline/feature-cache";
import {
  OvernightIntelShell,
  OvernightNextActionsPanel,
  OvernightRelatedStrip,
} from "./overnight-intel-chrome";
import {
  OvernightEpaPanel,
  OvernightHistoryPanel,
  OvernightResearchPanel,
  OvernightScoutingPanel,
  OvernightSummaryPanel,
  OvernightSummaryTiles,
} from "./overnight-intel-panels";
import "./overnight-intel.css";

function isOvernightIntelView(value: unknown): value is OvernightIntelView {
  if (!value || typeof value !== "object") return false;
  const status = (value as { status?: unknown }).status;
  return status === "setup_required" || status === "live";
}

async function persistOvernightIntelSnapshot(orgHint: string, data: OvernightIntelView): Promise<void> {
  const cacheOrg =
    "orgId" in data && typeof data.orgId === "string" && data.orgId.trim() ? data.orgId : orgHint;
  if (!cacheOrg) return;
  try {
    await putFeatureSnapshot("overnight-intel", cacheOrg, data);
    if (!orgHint) await putFeatureSnapshot("overnight-intel", "_", data);
  } catch {
    // Live brief already painted; IndexedDB is best-effort.
  }
}

export default function OvernightIntelClient() {
  const [view, setView] = useState<OvernightIntelView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const viewRef = useRef<OvernightIntelView | null>(null);
  viewRef.current = view;

  const load = useCallback(() => {
    void (async () => {
      const params = new URLSearchParams(window.location.search);
      const urlOrg = params.get("orgId")?.trim() ?? "";
      let hadCache = Boolean(viewRef.current);
      try {
        const cached = await getFeatureSnapshot<OvernightIntelView>("overnight-intel", urlOrg || "_");
        if (!viewRef.current && cached?.data && isOvernightIntelView(cached.data)) {
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
        const response = await fetch(
          `/api/overnight-intel${query.toString() ? `?${query.toString()}` : ""}`,
          {
            cache: "no-store",
            signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
          },
        );
        const data = (await response.json()) as OvernightIntelView | { error?: string };
        if (!response.ok || !isOvernightIntelView(data)) {
          if (hadCache || viewRef.current) {
            setFromCache(true);
            setError("Could not refresh the overnight brief. Showing the last copy on this device.");
            setFetchFailed(false);
          } else {
            setFetchFailed(true);
          }
          return;
        }
        setView(data);
        setFromCache(false);
        setCachedAt(null);
        await persistOvernightIntelSnapshot(urlOrg, data);
      } catch {
        if (hadCache || viewRef.current) {
          setFromCache(true);
          setError("Could not refresh the overnight brief. Showing the last copy on this device.");
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

  const orgId = view && "orgId" in view ? view.orgId : null;
  const briefCount = view?.status === "live" ? view.briefs.length : 0;
  const signalCount = view?.status === "live" ? overnightIntelSignalCount(view.signals) : 0;
  const needsActiveEvent =
    view?.status === "setup_required" &&
    Boolean(view.orgId) &&
    view.steps.some((step) => step.id === "active-event");

  const shell = classifyOvernightIntelShell({
    loading: view == null && !fetchFailed,
    fetchFailed,
    status: view?.status ?? null,
    orgId: view?.status === "live" ? view.orgId : view?.status === "setup_required" ? view.orgId : null,
    briefCount,
    signalCount,
  });
  const shellCopy = overnightIntelShellCopy(shell);
  const nextActions = overnightIntelNextActions({
    orgId,
    shell,
    briefCount,
    signalCount,
    needsActiveEvent,
  });
  const competitionHref = hubWorkbenchHref("competition", "overnight-intel", orgId);
  const scoutingHref = hubHref("/competition", "scouting", orgId);

  const generateBrief = useCallback(async () => {
    if (!orgId || busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/overnight-intel", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId, action: "generate-brief" }),
        signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
      });
      const data = (await response.json()) as OvernightIntelView | { error?: string };
      if (!response.ok || !isOvernightIntelView(data)) {
        setError("error" in data && data.error ? data.error : "Something went wrong.");
        return;
      }
      setView(data);
      void persistOvernightIntelSnapshot(orgId, data);
    } catch {
      setError("Network error — please try again.");
    } finally {
      setBusy(false);
    }
  }, [orgId, busy]);

  if (shell === "loading") {
    return (
      <OvernightIntelShell description={shellCopy.description} orgId={null} shell="loading">
        <OfflineBanner feature="Overnight brief" fromCache={fromCache} cachedAt={cachedAt} />
      </OvernightIntelShell>
    );
  }

  if (shell === "error") {
    return (
      <OvernightIntelShell
        description={shellCopy.description}
        orgId={orgId}
        shell="error"
        error={error || shellCopy.description}
        onRetry={() => load()}
      >
        <OfflineBanner feature="Overnight brief" fromCache={fromCache} cachedAt={cachedAt} />
      </OvernightIntelShell>
    );
  }

  if (shell === "setup") {
    return (
      <OvernightIntelShell
        description={view?.status === "setup_required" ? view.message : shellCopy.description}
        orgId={orgId}
        shell="setup"
        needsActiveEvent={needsActiveEvent}
      >
        <OfflineBanner feature="Overnight brief" fromCache={fromCache} cachedAt={cachedAt} />
      </OvernightIntelShell>
    );
  }

  if (view?.status !== "live") {
    return (
      <OvernightIntelShell description={shellCopy.description} orgId={orgId} shell="setup">
        <OfflineBanner feature="Overnight brief" fromCache={fromCache} cachedAt={cachedAt} />
      </OvernightIntelShell>
    );
  }

  return (
    <main className="module-page overnight-intel-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={competitionHref}>Competition</a>
            {" / Overnight brief"}
          </>
        }
        title="Overnight brief"
        description={shellCopy.description}
      >
        <OvernightRelatedStrip orgId={orgId} />
      </PageHeader>
      <OfflineBanner feature="Overnight brief" fromCache={fromCache} cachedAt={cachedAt} />

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      {shell === "ready" ? <OvernightNextActionsPanel actions={nextActions} /> : null}

      <OvernightSummaryTiles briefCount={briefCount} signalCount={signalCount} />

      {shell === "empty" ? (
        <EmptyState
          soft
          badge="Nothing new yet"
          badgeTone="setup"
          title={shellCopy.title}
          description={shellCopy.description}
        >
          <Button variant="primary" type="button" disabled={busy} onClick={() => void generateBrief()}>
            {busy ? "Saving…" : "Save tonight's brief"}
          </Button>
        </EmptyState>
      ) : null}

      <div className="overnight-intel-layout">
        {shell === "ready" ? (
          <OvernightSummaryPanel view={view} busy={busy} onGenerate={() => void generateBrief()} />
        ) : null}
        {shell === "ready" ? (
          <>
            <OvernightResearchPanel view={view} />
            <OvernightEpaPanel view={view} />
            <OvernightScoutingPanel view={view} />
            <OvernightHistoryPanel view={view} />
          </>
        ) : null}
        <p className="app-muted overnight-intel-tip">
          Keep logging in <a href={scoutingHref}>Scouting</a> so tomorrow morning has something new.
        </p>
      </div>
    </main>
  );
}
