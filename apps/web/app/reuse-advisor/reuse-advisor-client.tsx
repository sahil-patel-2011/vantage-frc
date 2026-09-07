"use client";

import { useCallback, useEffect, useState } from "react";
import { EmptyState, PageHeader, Panel } from "../../components/ui";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";
import { REUSE_ASSESSMENT_STATUSES, reuseRecommendationLabel, subsystemCategoryLabel } from "../../lib/reuse-advisor";
import type { ReuseAdvisorView } from "../../lib/reuse-advisor/compute-reuse-advisor";
import type { ReuseAssessmentStatus, ReuseCandidate, ReuseRecommendation } from "../../lib/reuse-advisor/types";
import { renderReceiptFrom, type RenderReceipt } from "../../lib/ai-render/outcome";
import { RenderAttribution } from "../../components/ui/render-attribution";

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

export default function ReuseAdvisorClient() {
  const [view, setView] = useState<ReuseAdvisorView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  // Kept so an expired session offers sign-in instead of a Retry that cannot work.
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false);
  // Honest badge for the latest render: "AI" only when a model produced it.
  const [renderReceipt, setRenderReceipt] = useState<RenderReceipt | null>(null);
  const [season, setSeason] = useState<number | null>(null);

  const orgId = view && "orgId" in view ? view.orgId : null;

  const load = useCallback((seasonOverride?: number) => {
    setFetchFailed(false);
    setErrorStatus(null);
    setLoadError("");
    setError("");
    const params = new URLSearchParams(window.location.search);
    const urlOrg = params.get("orgId");
    const seasonQuery = seasonOverride ?? (params.get("season") ? Number(params.get("season")) : null);
    const query = new URLSearchParams();
    if (urlOrg) query.set("orgId", urlOrg);
    if (seasonQuery) query.set("season", String(seasonQuery));
    void fetch(`/api/reuse-advisor${query.toString() ? `?${query.toString()}` : ""}`)
      .then(async (response) => {
        const data = (await response.json()) as ReuseAdvisorView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setErrorStatus(response.status);
          setLoadError("error" in data && data.error ? data.error : "");
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
        });
        const data = (await response.json()) as ReuseAdvisorView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setError("error" in data && data.error ? data.error : "Something went wrong.");
          return;
        }
        setView(data);
        setSeason(data.seasonYear);
        const receipt = renderReceiptFrom(data);
        if (receipt) setRenderReceipt(receipt);
      } catch {
        setError("Network error — please try again.");
      } finally {
        setBusy(false);
      }
    },
    [orgId, season, busy],
  );

  return (
    <main className="module-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={orgId ? `/build?orgId=${encodeURIComponent(orgId)}` : "/build"}>Build</a>
            {" / Reuse Advisor"}
          </>
        }
        title="Reuse Advisor"
        description="Cross-season subsystem reuse recommendations — mined from prior FMEA failure history and design-review track record for each subsystem you designed before."
      >
        {view?.status === "live" && view.seasons.length > 0 ? (
          <label className="app-muted" style={{ display: "flex", gap: 6, alignItems: "center" }}>
            Design season
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
      </PageHeader>

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      <RenderAttribution receipt={renderReceipt} feature="reuse_advisor" />

      {fetchFailed ? (
        (() => {
          const copy = loadFailureCopy(
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
          );
          return (
            <EmptyState title={copy.title} description={copy.description}>
              {copy.primary ? (
                <a className="app-button" href={copy.primary.href}>
                  {copy.primary.label}
                </a>
              ) : null}
              {copy.showRetry ? (
                <button type="button" className="app-button secondary" onClick={() => load()}>
                  Retry
                </button>
              ) : null}
            </EmptyState>
          );
        })()
      ) : view == null ? (
        <EmptyState title="Loading…" description="Checking your workspace." aria-busy />
      ) : view.status === "setup_required" ? (
        <EmptyState badge="Setup required" badgeTone="setup" title={view.message}>
          <ol className="strategy-setup-steps">
            {view.steps.map((step) => (
              <li key={step.id}>
                <div>
                  <strong>{step.label}</strong>
                  <span>{step.detail}</span>
                </div>
                <a href={step.href} aria-label={step.label}>Open</a>
              </li>
            ))}
          </ol>
        </EmptyState>
      ) : (
        <div style={{ display: "grid", gap: 16 }}>
          {view.candidates.length > 0 ? (
            <CandidatesPanel view={view} busy={busy} mutate={mutate} />
          ) : (
            <EmptyState
              badge="No prior-season subsystems"
              badgeTone="setup"
              title="Log subsystems from prior seasons to get reuse recommendations"
              description="Add subsystems on the Build spec sheet in past seasons (season year below the current design season) — Vantage cross-references their FMEA and design-review history here."
            />
          )}
          {view.assessments.length > 0 ? (
            <AssessmentsPanel view={view} busy={busy} mutate={mutate} />
          ) : null}
        </div>
      )}
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
          <button
            type="button"
            className="app-button secondary"
            disabled={busy}
            onClick={() =>
              mutate({
                action: "assess",
                subsystemId: candidate.subsystemId,
                subsystemName: candidate.subsystemName,
                category: candidate.category,
                sourceSeasonYear: candidate.sourceSeasonYear,
              })
            }
          >
            Record assessment
          </button>
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
                  <button
                    key={status}
                    type="button"
                    className="app-button secondary"
                    disabled={busy}
                    onClick={() => mutate({ action: "update-status", assessmentId: assessment.id, status })}
                  >
                    Mark {STATUS_LABEL[status].toLowerCase()}
                  </button>
                ))}
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </Panel>
  );
}
