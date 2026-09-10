"use client";

import { useCallback, useEffect, useState } from "react";
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
import { withOrgHref } from "../../lib/nav/product-nav";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import { InspectionNextActionsPanel, InspectionShell } from "./inspection-chrome";
import { ChecksList } from "./inspection-checks-list";
import { NewCheckForm } from "./inspection-new-check-form";
import { SummaryTiles } from "./inspection-summary";
import "./inspection-copilot.css";

export default function InspectionCopilotClient() {
  const [view, setView] = useState<InspectionCopilotView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [season, setSeason] = useState<number | null>(null);

  const load = useCallback((seasonOverride?: number) => {
    setFetchFailed(false);
    setError("");
    const params = new URLSearchParams(window.location.search);
    const urlOrg = params.get("orgId");
    const seasonQuery = seasonOverride ?? (params.get("season") ? Number(params.get("season")) : null);
    const query = new URLSearchParams();
    if (urlOrg) query.set("orgId", urlOrg);
    if (seasonQuery) query.set("season", String(seasonQuery));
    void fetch(`/api/inspection-copilot${query.toString() ? `?${query.toString()}` : ""}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
    })
      .then(async (response) => {
        const data = (await response.json()) as InspectionCopilotView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setFetchFailed(true);
          return;
        }
        setView(data);
        setSeason(data.seasonYear);
      })
      .catch(() => setFetchFailed(true));
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
  const buildHref = hubHref("/build", "fmea", orgId);
  const batteriesHref = hubHref("/team", "batteries", orgId);
  const fmeaHref = hubHref("/build", "fmea", orgId);
  const subsystemsHref = withOrgHref("/subsystems", orgId);

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
      <InspectionShell description={shellCopy.description} orgId={null} shell="loading" />
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
      />
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
      />
    );
  }

  if (view?.status !== "live") {
    return <InspectionShell description={shellCopy.description} orgId={orgId} shell="setup" />;
  }

  return (
    <main className="module-page inspection-copilot-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={buildHref}>Build</a>
            {" / Inspection Copilot"}
          </>
        }
        title="Inspection-Readiness Copilot"
        description="Compare declared weight, frame/bumper, and wiring limits against measured robot values before you travel. Cross-check Batteries, FMEA, and Subsystems."
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

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      <InspectionNextActionsPanel actions={nextActions} />

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
                <a href={batteriesHref}>Batteries</a>, <a href={fmeaHref}>FMEA</a>, and{" "}
                <a href={subsystemsHref}>Subsystems</a> aligned with weigh-in rows.
              </p>
            </Panel>
          </>
        ) : null}
      </div>
    </main>
  );
}
