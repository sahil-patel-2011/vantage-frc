"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { OfflineBanner } from "../../components/offline-banner";
import { EmptyState, PageHeader, Panel, Button } from "../../components/ui";
import type { InspectionCopilotView } from "../../lib/inspection-copilot/compute-inspection-copilot";
import {
  INSPECTION_COPILOT_RELATED_INCLUDE,
  classifyInspectionCopilotShell,
  inspectionCopilotNextActions,
  inspectionCopilotRelatedLinks,
  inspectionCopilotShellCopy,
} from "../../lib/inspection-copilot/inspection-copilot-related";
import { hubHref } from "../../lib/nav/hubs";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import { getFeatureSnapshot, putFeatureSnapshot, clearFeatureSnapshot } from "../../lib/offline/feature-cache";
import { InspectionNextActionsPanel, InspectionShell } from "./inspection-chrome";
import { ChecksList } from "./inspection-checks-list";
import { NewCheckForm } from "./inspection-new-check-form";
import { SummaryTiles } from "./inspection-summary";
import "./inspection-copilot.css";

function isInspectionCopilotView(value: unknown): value is InspectionCopilotView {
  if (!value || typeof value !== "object") return false;
  const status = (value as { status?: unknown }).status;
  return status === "setup_required" || status === "live";
}

async function persistInspectionCopilotSnapshot(
  orgHint: string,
  seasonHint: string,
  data: InspectionCopilotView,
): Promise<void> {
  const cacheOrg =
    "orgId" in data && typeof data.orgId === "string" && data.orgId.trim() ? data.orgId : orgHint;
  if (!cacheOrg) return;
  const seasonKey = String(data.seasonYear);
  try {
    await putFeatureSnapshot("inspection-copilot", cacheOrg, data, seasonHint || seasonKey);
    if (!orgHint) await putFeatureSnapshot("inspection-copilot", "_", data, seasonHint || seasonKey);
  } catch {
    // Live checks already painted; IndexedDB is best-effort.
  }
}

export default function InspectionCopilotClient() {
  const [view, setView] = useState<InspectionCopilotView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [season, setSeason] = useState<number | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const viewRef = useRef<InspectionCopilotView | null>(null);
  viewRef.current = view;

  const load = useCallback((seasonOverride?: number) => {
    void (async () => {
      const params = new URLSearchParams(window.location.search);
      const urlOrg = params.get("orgId")?.trim() ?? "";
      const seasonQuery =
        seasonOverride ?? (params.get("season") ? Number(params.get("season")) : null);
      const seasonHint =
        seasonQuery != null && Number.isFinite(seasonQuery) ? String(seasonQuery) : "";
      let hadCache = Boolean(viewRef.current);
      try {
        const cached = await getFeatureSnapshot<InspectionCopilotView>(
          "inspection-copilot",
          urlOrg || "_",
          seasonHint,
        );
        if (!viewRef.current && cached?.data && isInspectionCopilotView(cached.data)) {
          setView(cached.data);
          setSeason(cached.data.seasonYear);
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
      if (seasonHint) query.set("season", seasonHint);
      try {
        const response = await fetch(
          `/api/inspection-copilot${query.toString() ? `?${query.toString()}` : ""}`,
          {
            cache: "no-store",
            signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
          },
        );
        const data = (await response.json()) as InspectionCopilotView | { error?: string };
        if (response.status === 401 || response.status === 403) {
          setView(null);
          setFromCache(false);
          setCachedAt(null);
          setFetchFailed(true);
          void clearFeatureSnapshot("inspection-copilot", urlOrg || "_", seasonHint);
          if (urlOrg) void clearFeatureSnapshot("inspection-copilot", urlOrg, seasonHint);
          return;
        }
        if (!response.ok || !isInspectionCopilotView(data)) {
          if (hadCache || viewRef.current) {
            setFromCache(true);
            setError("Could not refresh Inspection Copilot. Showing the last copy on this device.");
            setFetchFailed(false);
          } else {
            setFetchFailed(true);
          }
          return;
        }
        setView(data);
        setSeason(data.seasonYear);
        setFromCache(false);
        setCachedAt(null);
        await persistInspectionCopilotSnapshot(urlOrg, seasonHint, data);
      } catch {
        if (hadCache || viewRef.current) {
          setFromCache(true);
          setError("Could not refresh Inspection Copilot. Showing the last copy on this device.");
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
  const checkCount = view?.status === "live" ? view.checks.length : 0;
  const flaggedCount =
    view?.status === "live" ? view.checks.filter((check) => check.flags.length > 0).length : 0;
  const criticalCount =
    view?.status === "live"
      ? view.checks.reduce(
          (sum, check) => sum + check.flags.filter((flag) => flag.severity === "critical").length,
          0,
        )
      : 0;
  const latestRisk =
    view?.status === "live" && view.checks[0] ? view.checks[0].riskScore : null;

  const shell = classifyInspectionCopilotShell({
    loading: view == null && !fetchFailed,
    fetchFailed,
    status: view?.status ?? null,
    orgId: view?.status === "live" ? view.orgId : view?.status === "setup_required" ? view.orgId : null,
    checkCount,
  });
  const shellCopy = inspectionCopilotShellCopy(shell);
  const nextActions = inspectionCopilotNextActions({
    orgId,
    shell,
    checkCount,
    flaggedCount,
    criticalCount,
  });
  const relatedLinks = inspectionCopilotRelatedLinks(orgId, {
    include: [...INSPECTION_COPILOT_RELATED_INCLUDE],
  });
  const competitionHref = hubHref("/competition", "command", orgId);
  const batteriesHref = hubHref("/team", "batteries", orgId);
  const fmeaHref = hubHref("/build", "fmea", orgId);
  const weighInHref = hubHref("/build", "robot-weigh-in", orgId);

  const mutate = useCallback(
    async (payload: Record<string, unknown>) => {
      if (!orgId || busy) return;
      setBusy(true);
      setError("");
      try {
        const response = await fetch("/api/inspection-copilot", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, seasonYear: season ?? undefined, ...payload }),
          signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
        });
        const data = (await response.json()) as InspectionCopilotView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setError("error" in data && data.error ? data.error : "Something went wrong.");
          return;
        }
        setView(data);
        setSeason(data.seasonYear);
        void persistInspectionCopilotSnapshot(orgId, season != null ? String(season) : "", data);
      } catch {
        setError("Network error — please try again.");
      } finally {
        setBusy(false);
      }
    },
    [orgId, season, busy],
  );

  if (shell === "loading") {
    return (
      <InspectionShell description={shellCopy.description} orgId={null} shell="loading">
        <OfflineBanner feature="Inspection Copilot" fromCache={fromCache} cachedAt={cachedAt} />
      </InspectionShell>
    );
  }

  if (shell === "error") {
    return (
      <InspectionShell
        description={shellCopy.description}
        orgId={orgId}
        shell="error"
        error={error || shellCopy.description}
        onRetry={() => load()}
      >
        <OfflineBanner feature="Inspection Copilot" fromCache={fromCache} cachedAt={cachedAt} />
      </InspectionShell>
    );
  }

  if (shell === "setup") {
    return (
      <InspectionShell
        description={
          view?.status === "setup_required" ? view.message : shellCopy.description
        }
        orgId={orgId}
        shell="setup"
      >
        <OfflineBanner feature="Inspection Copilot" fromCache={fromCache} cachedAt={cachedAt} />
      </InspectionShell>
    );
  }

  if (view?.status !== "live") {
    return (
      <InspectionShell description={shellCopy.description} orgId={orgId} shell="setup">
        <OfflineBanner feature="Inspection Copilot" fromCache={fromCache} cachedAt={cachedAt} />
      </InspectionShell>
    );
  }

  return (
    <main className="module-page inspection-copilot-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={competitionHref}>Competition</a>
            {" / Inspection"}
          </>
        }
        title="Inspection"
        description="Compare declared weight, frame/bumper, and wiring limits against measured robot values before you travel. Cross-check Batteries, Failure log, and Weigh-in."
      >
        <div className="inspection-copilot-header-actions">
          {view.seasons.length > 0 ? (
            <label className="app-muted inspection-copilot-season">
              Season
              <select
                value={season ?? view.seasonYear}
                onChange={(event) => {
                  const next = Number(event.target.value);
                  setSeason(next);
                  load(next);
                }}
              >
                {view.seasons.map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {relatedLinks.map((link) => (
            <Button as="a" variant="secondary" key={link.id} href={link.href}>
              {link.label}
            </Button>
          ))}
        </div>
      </PageHeader>

      <OfflineBanner feature="Inspection Copilot" fromCache={fromCache} cachedAt={cachedAt} />

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      {shell === "ready" ? <InspectionNextActionsPanel actions={nextActions} /> : null}

      <SummaryTiles
        checkCount={checkCount}
        flaggedCount={flaggedCount}
        criticalCount={criticalCount}
        latestRisk={latestRisk}
        loaded
      />

      {shell === "empty" ? (
        <EmptyState
          soft
          badge="No checks yet"
          badgeTone="setup"
          title={shellCopy.title}
          description={shellCopy.description}
        >
          <Button as="a" variant="primary" href="#inspection-copilot-form">
            Run a check
          </Button>
        </EmptyState>
      ) : null}

      <div className="inspection-copilot-layout">
        <NewCheckForm busy={busy} mutate={mutate} />
        {shell === "ready" ? (
          <>
            <ChecksList view={view} busy={busy} mutate={mutate} />
            <Panel className="inspection-copilot-tip" aria-label="Readiness tip">
              <span className="eyebrow">Before travel</span>
              <p className="app-muted" style={{ marginTop: 8 }}>
                Resolve critical flags from logged measurements first. Keep{" "}
                <a href={batteriesHref}>Batteries</a>, <a href={fmeaHref}>Failure log</a>, and{" "}
                <a href={weighInHref}>Weigh-in</a> aligned with those rows.
              </p>
            </Panel>
          </>
        ) : null}
      </div>
    </main>
  );
}
