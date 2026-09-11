"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { OfflineBanner } from "../../components/offline-banner";
import { EmptyState, PageHeader, Panel, Button } from "../../components/ui";
import { hubHref } from "../../lib/nav/hubs";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../lib/offline/feature-cache";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";
import { REUSE_ASSESSMENT_STATUSES, reuseRecommendationLabel, subsystemCategoryLabel } from "../../lib/reuse-advisor";
import type { ReuseAdvisorView } from "../../lib/reuse-advisor/compute-reuse-advisor";
import type { ReuseAssessmentStatus, ReuseCandidate, ReuseRecommendation } from "../../lib/reuse-advisor/types";

const RECOMMENDATION_TONE: Record<ReuseRecommendation, string> = {
  reuse: "good",
  modify: "setup",
  avoid: "demo",
};

const STATUS_LABEL: Record<ReuseAssessmentStatus, string> = {
  open: "Open",
  accepted: "Accepted",
  dismissed: "Dismissed",
};

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

type LiveView = Extract<ReuseAdvisorView, { status: "live" }>;

function isReuseAdvisorView(value: unknown): value is ReuseAdvisorView {
  if (!value || typeof value !== "object") return false;
  const status = (value as { status?: unknown }).status;
  return status === "setup_required" || status === "live";
}

function reuseAdvisorCacheOrg(data: ReuseAdvisorView, orgHint: string): string {
  switch (data.status) {
    case "setup_required":
      return (typeof data.orgId === "string" && data.orgId.trim()) || orgHint;
    case "live":
      return data.orgId.trim() || orgHint;
    default: {
      data satisfies never;
      return orgHint;
    }
  }
}

async function persistReuseAdvisorSnapshot(
  orgHint: string,
  seasonHint: string,
  data: ReuseAdvisorView,
): Promise<void> {
  const cacheOrg = reuseAdvisorCacheOrg(data, orgHint);
  if (!cacheOrg) return;
  const seasonKey = String(data.seasonYear);
  try {
    await putFeatureSnapshot("reuse-advisor", cacheOrg, data, seasonHint || seasonKey);
    if (!orgHint) await putFeatureSnapshot("reuse-advisor", "_", data, seasonHint || seasonKey);
  } catch {
    // Live Reuse Advisor already painted; IndexedDB is best-effort.
  }
}

function ReuseAdvisorRelated({ orgId }: { orgId?: string | null }) {
  return (
    <nav className="product-hub-related" aria-label="Related build tools">
      <Button as="a" variant="secondary" href={hubHref("/build", "subsystems", orgId)}>
        Subsystems
      </Button>
      <Button as="a" variant="secondary" href={hubHref("/build", "fmea", orgId)}>
        FMEA
      </Button>
      <Button as="a" variant="secondary" href={hubHref("/build", "readiness-score", orgId)}>
        Readiness
      </Button>
    </nav>
  );
}

function ReuseAdvisorNextActions({ orgId }: { orgId: string }) {
  const actions = [
    {
      id: "subsystems",
      label: "Open Subsystems",
      detail: "Reuse candidates come from prior-season subsystem rows.",
      href: hubHref("/build", "subsystems", orgId),
      primary: true,
    },
    {
      id: "fmea",
      label: "Open FMEA",
      detail: "Failure history is what makes a reuse recommendation honest.",
      href: hubHref("/build", "fmea", orgId),
      primary: false,
    },
    {
      id: "readiness",
      label: "Open Readiness",
      detail: "Ship-readiness still has to match the mechanism you keep.",
      href: hubHref("/build", "readiness-score", orgId),
      primary: false,
    },
  ];
  return (
    <section className="app-card soft-panel edc-next-actions" aria-label="Next actions">
      <header>
        <h2>Next actions</h2>
        <p className="app-muted">Each one opens the page where you finish the work.</p>
      </header>
      <ol>
        {actions.map((action) => (
          <li key={action.id} className={action.primary ? "primary" : undefined}>
            <div>
              <strong>{action.label}</strong>
              <span>{action.detail}</span>
            </div>
            <Button as="a" variant="secondary" href={action.href}>
              Open
            </Button>
          </li>
        ))}
      </ol>
    </section>
  );
}

export default function ReuseAdvisorClient() {
  const [view, setView] = useState<ReuseAdvisorView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false);
  const [season, setSeason] = useState<number | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const viewRef = useRef<ReuseAdvisorView | null>(null);
  viewRef.current = view;

  const orgId = view && "orgId" in view ? view.orgId : null;

  const load = useCallback(async (seasonOverride?: number) => {
    const params = new URLSearchParams(window.location.search);
    const orgHint = params.get("orgId")?.trim() ?? "";
    const seasonQuery = seasonOverride ?? (params.get("season") ? Number(params.get("season")) : null);
    const seasonHint =
      seasonQuery && Number.isFinite(seasonQuery) ? String(seasonQuery) : String(new Date().getFullYear());
    let hadCache = Boolean(viewRef.current);
    try {
      const cached = await getFeatureSnapshot<ReuseAdvisorView>("reuse-advisor", orgHint || "_", seasonHint);
      if (!viewRef.current && cached?.data && isReuseAdvisorView(cached.data)) {
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
    setErrorStatus(null);
    setLoadError("");
    try {
      const query = new URLSearchParams();
      if (orgHint) query.set("orgId", orgHint);
      if (seasonQuery) query.set("season", String(seasonQuery));
      const response = await fetch(`/api/reuse-advisor${query.toString() ? `?${query.toString()}` : ""}`, {
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
        setLoadError(
          data && typeof data === "object" && "error" in data && typeof data.error === "string"
            ? data.error
            : "",
        );
        return;
      }
      if (!response.ok || !isReuseAdvisorView(data)) {
        if (hadCache || viewRef.current) {
          setFromCache(true);
          setError("Could not refresh Reuse Advisor. Showing the last copy on this device.");
          setFetchFailed(false);
          return;
        }
        setFetchFailed(true);
        setErrorStatus(response.status);
        setLoadError(
          data && typeof data === "object" && "error" in data && typeof data.error === "string"
            ? data.error
            : "",
        );
        return;
      }
      setView(data);
      setSeason(data.seasonYear);
      setFromCache(false);
      setCachedAt(null);
      await persistReuseAdvisorSnapshot(orgHint, seasonHint, data);
    } catch {
      if (hadCache || viewRef.current) {
        setFromCache(true);
        setError("Could not refresh Reuse Advisor. Showing the last copy on this device.");
        setFetchFailed(false);
        return;
      }
      setFetchFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const mutate = useCallback(
    async (payload: Record<string, unknown>) => {
      if (!orgId || busy) return;
      setBusy(true);
      setError("");
      try {
        const response = await fetch("/api/reuse-advisor", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, seasonYear: season ?? undefined, ...payload }),
          signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
        });
        const data: unknown = await response.json().catch(() => null);
        if (!response.ok || !isReuseAdvisorView(data)) {
          setError(
            data && typeof data === "object" && "error" in data && typeof data.error === "string"
              ? data.error
              : "Something went wrong.",
          );
          return;
        }
        setView(data);
        setSeason(data.seasonYear);
        setFromCache(false);
        void persistReuseAdvisorSnapshot(orgId, String(data.seasonYear), data);
      } catch {
        setError("Network error — please try again.");
      } finally {
        setBusy(false);
      }
    },
    [orgId, season, busy],
  );

  const buildHref = orgId ? `/build?orgId=${encodeURIComponent(orgId)}` : "/build";
  const header = (
    <PageHeader
      breadcrumbs={
        <>
          <a href={buildHref}>Build</a>
          {" / Reuse Advisor"}
        </>
      }
      title="Reuse Advisor"
      description="Cross-season subsystem reuse recommendations — mined from prior FMEA failure history and design-review track record for each subsystem you designed before."
    >
      <ReuseAdvisorRelated orgId={orgId} />
      {view?.status === "live" && view.seasons.length > 0 ? (
        <label className="app-muted" style={{ display: "flex", gap: 6, alignItems: "center" }}>
          Design season
          <select
            value={season ?? view.seasonYear}
            onChange={(event) => {
              const next = Number(event.target.value);
              setSeason(next);
              void load(next);
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
    </PageHeader>
  );

  if (!view) {
    const copy = fetchFailed
      ? loadFailureCopy(
          classifyLoadFailure({
            status: errorStatus,
            message: loadError,
            online: typeof navigator === "undefined" ? true : navigator.onLine,
          }),
          {
            nextPath:
              typeof window === "undefined"
                ? null
                : `${window.location.pathname}${window.location.search}`,
            message: loadError || "A network or server issue prevented loading. Try again.",
          },
        )
      : null;
    return (
      <main className="module-page">
        {header}
        <OfflineBanner feature="Reuse Advisor" fromCache={fromCache} cachedAt={cachedAt} />
        <EmptyState
          title={copy ? copy.title : "Loading…"}
          description={copy ? copy.description : "Checking your team."}
          aria-busy={!fetchFailed}
        >
          {copy?.primary ? (
            <Button as="a" variant="primary" href={copy.primary.href}>
              {copy.primary.label}
            </Button>
          ) : null}
          {copy?.showRetry ? (
            <Button variant="secondary" type="button" onClick={() => void load()}>
              Retry
            </Button>
          ) : null}
        </EmptyState>
      </main>
    );
  }

  switch (view.status) {
    case "setup_required":
      return (
        <main className="module-page">
          {header}
          <OfflineBanner feature="Reuse Advisor" fromCache={fromCache} cachedAt={cachedAt} />
          {error ? (
            <p className="telemetry-status" role="alert">
              {error}
            </p>
          ) : null}
          <EmptyState badge="Needs setup" badgeTone="setup" title={view.message}>
            {view.steps[0] ? (
              <Button as="a" variant="primary" href={view.steps[0].href}>
                {view.steps[0].label}
              </Button>
            ) : null}
          </EmptyState>
        </main>
      );
    case "live":
      break;
    default: {
      view satisfies never;
      return null;
    }
  }

  return (
    <main className="module-page">
      {header}
      <OfflineBanner feature="Reuse Advisor" fromCache={fromCache} cachedAt={cachedAt} />
      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}
      <ReuseAdvisorNextActions orgId={view.orgId} />
      <div style={{ display: "grid", gap: 16 }}>
        {view.candidates.length > 0 ? (
          <CandidatesPanel view={view} busy={busy} mutate={mutate} />
        ) : (
          <EmptyState
            badge="No prior-season subsystems"
            badgeTone="setup"
            title="Log subsystems from prior seasons to get reuse recommendations"
            description="Add subsystems on the Build spec sheet in past seasons (season year below the current design season). Reuse recommendations use their FMEA and design-review history here."
          >
            <Button as="a" variant="primary" href={hubHref("/build", "subsystems", view.orgId)}>
              Open Subsystems
            </Button>
          </EmptyState>
        )}
        {view.assessments.length > 0 ? (
          <AssessmentsPanel view={view} busy={busy} mutate={mutate} />
        ) : null}
      </div>
    </main>
  );
}

function CandidatesPanel({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>Reuse candidates</h2>
      <p className="app-muted" style={{ marginTop: 0 }}>
        Prior-season subsystems, cross-referenced against FMEA failure history and design-review outcomes.
      </p>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 10 }}>
        {view.candidates.map((candidate) => (
          <CandidateRow key={candidate.subsystemId} candidate={candidate} busy={busy} mutate={mutate} />
        ))}
      </ul>
    </Panel>
  );
}

function CandidateRow({
  candidate,
  busy,
  mutate,
}: {
  candidate: ReuseCandidate;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  return (
    <li className="app-card soft-panel" style={{ display: "grid", gap: 6 }}>
      <header style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
        <div>
          <span className={`app-badge ${RECOMMENDATION_TONE[candidate.recommendation]}`}>
            {reuseRecommendationLabel(candidate.recommendation)}
          </span>
          <strong style={{ display: "block", marginTop: 4 }}>{candidate.subsystemName}</strong>
          <small className="app-muted">
            {subsystemCategoryLabel(candidate.category)} · from {candidate.sourceSeasonYear} ·{" "}
            {candidate.motorType || "motor unspecified"} · confidence {pct(candidate.confidence)}
          </small>
        </div>
        {!candidate.alreadyAssessed ? (
          <Button variant="secondary" type="button" disabled={busy} onClick={() => mutate({ action: "assess", subsystemId: candidate.subsystemId, subsystemName: candidate.subsystemName, category: candidate.category, sourceSeasonYear: candidate.sourceSeasonYear, }) }>
            Record assessment
          </Button>
        ) : (
          <small className="app-muted">Assessed</small>
        )}
      </header>
      <small className="app-muted">{candidate.rationale}</small>
      <small className="app-muted">
        {candidate.fmeaFailureCount} prior FMEA failure(s) · {candidate.fmeaHighSeverityCount} high-severity ·{" "}
        {candidate.designReviewPassCount}/{candidate.designReviewCount} design review(s) passed
      </small>
    </li>
  );
}

function AssessmentsPanel({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>Recorded assessments</h2>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 10 }}>
        {view.assessments.map((assessment) => (
          <li key={assessment.id} className="app-card soft-panel" style={{ display: "grid", gap: 6 }}>
            <header style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
              <div>
                <span className={`app-badge ${RECOMMENDATION_TONE[assessment.recommendation]}`}>
                  {reuseRecommendationLabel(assessment.recommendation)}
                </span>
                <strong style={{ display: "block", marginTop: 4 }}>{assessment.subsystemName}</strong>
                <small className="app-muted">
                  {subsystemCategoryLabel(assessment.category)} · {STATUS_LABEL[assessment.status]} · confidence{" "}
                  {pct(assessment.confidence)}
                </small>
              </div>
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() => {
                  if (window.confirm(`Delete assessment for "${assessment.subsystemName}"?`)) {
                    mutate({ action: "delete-assessment", assessmentId: assessment.id });
                  }
                }}
              >
                Delete
              </button>
            </header>
            <small className="app-muted">{assessment.rationale}</small>
            {assessment.status === "open" ? (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {REUSE_ASSESSMENT_STATUSES.filter((status) => status !== assessment.status).map((status) => (
                  <Button variant="secondary" key={status} type="button" disabled={busy} onClick={() => mutate({ action: "update-status", assessmentId: assessment.id, status })}>
                    Mark {STATUS_LABEL[status].toLowerCase()}
                  </Button>
                ))}
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </Panel>
  );
}
