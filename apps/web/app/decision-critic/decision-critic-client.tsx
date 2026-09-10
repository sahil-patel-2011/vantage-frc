"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState, FormGrid, FormRow, PageHeader, Panel, Button } from "../../components/ui";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";
import {
  DECISION_CRITIC_CATEGORIES,
  DECISION_CRITIC_OUTCOMES,
  decisionOutcomeLabel,
  decisionVerdictLabel,
} from "../../lib/decision-critic";
import type { DecisionCriticView } from "../../lib/decision-critic/compute-decision-critic";
import type { DecisionCriticCategory, DecisionCriticVerdict } from "../../lib/decision-critic/types";

const VERDICT_TONE: Record<DecisionCriticVerdict, string> = {
  proceed: "good",
  proceed_with_caution: "setup",
  reconsider: "demo",
};

const CATEGORY_LABEL: Record<DecisionCriticCategory, string> = {
  design: "Design",
  strategy: "Strategy",
  build: "Build",
  process: "Process",
  other: "Other",
};

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

type LiveView = Extract<DecisionCriticView, { status: "live" }>;

export default function DecisionCriticClient() {
  const [view, setView] = useState<DecisionCriticView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  // Kept so an expired session offers sign-in instead of a Retry that cannot work.
  const [loadError, setLoadError] = useState("");
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [season, setSeason] = useState<number | null>(null);

  const orgId = view && "orgId" in view ? view.orgId : null;

  const load = useCallback((seasonOverride?: number) => {
    setFetchFailed(false);
    setError("");
    setLoadError("");
    setErrorStatus(null);
    const params = new URLSearchParams(window.location.search);
    const urlOrg = params.get("orgId");
    const seasonQuery = seasonOverride ?? (params.get("season") ? Number(params.get("season")) : null);
    const query = new URLSearchParams();
    if (urlOrg) query.set("orgId", urlOrg);
    if (seasonQuery) query.set("season", String(seasonQuery));
    void fetch(`/api/decision-critic${query.toString() ? `?${query.toString()}` : ""}`)
      .then(async (response) => {
        const data = (await response.json()) as DecisionCriticView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setFetchFailed(true);
          setErrorStatus(response.status);
          setLoadError("error" in data && data.error ? data.error : "");
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
        const response = await fetch("/api/decision-critic", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, seasonYear: season ?? undefined, ...payload }),
        });
        const data = (await response.json()) as DecisionCriticView | { error?: string };
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

  // Retry cannot fix an expired session, so the failure decides its own action.
  const failure = fetchFailed
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
      <PageHeader
        breadcrumbs={
          <>
            <a href={orgId ? `/build?orgId=${encodeURIComponent(orgId)}` : "/build"}>Build</a>
            {" / Decision Critic"}
          </>
        }
        title="Decision Critic"
        description="A devil's-advocate second opinion on a design decision, grounded in your FMEA history, weight/power headroom, and prior decision outcomes."
      >
        {view?.status === "live" && view.seasons.length > 0 ? (
          <label className="app-muted" style={{ display: "flex", gap: 6, alignItems: "center" }}>
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
      </PageHeader>

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      {failure ? (
        <EmptyState title={failure.title} description={failure.description}>
          {failure.primary ? (
            <Button as="a" variant="primary" href={failure.primary.href}>
              {failure.primary.label}
            </Button>
          ) : null}
          {failure.showRetry ? (
            <Button variant="secondary" type="button" onClick={() => load()}>
              Retry
            </Button>
          ) : null}
        </EmptyState>
      ) : view == null ? (
        <EmptyState title="Loading…" description="Checking your team." aria-busy />
      ) : view.status === "setup_required" ? (
        <EmptyState badge="Setup required" badgeTone="setup" title={view.message}>
          <ol className="strategy-setup-steps">
            {view.steps.map((step) => (
              <li key={step.id}>
                <div>
                  <strong>{step.label}</strong>
                  <span>{step.detail}</span>
                </div>
                <a href={step.href}>Open</a>
              </li>
            ))}
          </ol>
        </EmptyState>
      ) : (
        <div style={{ display: "grid", gap: 16 }}>
          <ReviewForm busy={busy} mutate={mutate} />
          {view.reviews.length > 0 ? (
            <ReviewsList view={view} busy={busy} mutate={mutate} />
          ) : (
            <EmptyState
              badge="No reviews yet"
              badgeTone="setup"
              title="Get your first second opinion"
              description="Once logged, Vantage cross-references FMEA history, weight/power headroom, and prior decision outcomes to give a grounded verdict."
            />
          )}
          <HeadroomPanels view={view} />
        </div>
      )}
    </main>
  );
}

function ReviewsList({
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
      <h2 style={{ marginTop: 0 }}>Reviews</h2>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 10 }}>
        {view.reviews.map((review) => (
          <li key={review.id} className="app-card soft-panel" style={{ display: "grid", gap: 6 }}>
            <header style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
              <div>
                <span className={`app-badge ${VERDICT_TONE[review.verdict]}`}>
                  {decisionVerdictLabel(review.verdict)}
                </span>
                <strong style={{ display: "block", marginTop: 4 }}>{review.title}</strong>
                <small className="app-muted">
                  {review.subsystemName} · {CATEGORY_LABEL[review.category]} · confidence {pct(review.confidence)}
                </small>
              </div>
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() => {
                  if (window.confirm(`Delete "${review.title}"?`)) {
                    mutate({ action: "delete-review", reviewId: review.id });
                  }
                }}
              >
                Delete
              </button>
            </header>
            {review.proposal ? <p style={{ margin: 0 }}>{review.proposal}</p> : null}
            {review.concerns.length > 0 ? (
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {review.concerns.map((concern, index) => (
                  <li key={index}>{concern}</li>
                ))}
              </ul>
            ) : (
              <p className="app-muted" style={{ margin: 0 }}>
                No grounded concerns found.
              </p>
            )}
            <small className="app-muted">{review.recommendation}</small>
            <small className="app-muted">
              +{review.weightAddedLbs} lb ({review.weightMarginLbs} lb margin before) · +{review.powerAddedAmps} A (
              {review.powerHeadroomAmps} A headroom before) · {review.chronicFailureCount} prior FMEA failure(s) ·{" "}
              {review.priorRejectedCount} similar rejected/superseded decision(s)
            </small>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <span className="app-muted">Outcome: {decisionOutcomeLabel(review.outcome)}</span>
              {DECISION_CRITIC_OUTCOMES.filter((outcome) => outcome !== review.outcome && outcome !== "open").map(
                (outcome) => (
                  <Button variant="secondary" key={outcome} type="button" disabled={busy} onClick={() => mutate({ action: "update-outcome", reviewId: review.id, outcome })}>
                    Mark {decisionOutcomeLabel(outcome).toLowerCase()}
                  </Button>
                ),
              )}
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function HeadroomPanels({ view }: { view: LiveView }) {
  return (
    <section
      className="app-card soft-panel"
      style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 20 }}
    >
      <div>
        <h2 style={{ marginTop: 0 }}>Weight headroom</h2>
        <p className="app-muted" style={{ margin: 0 }}>
          {view.weightHeadroom.totalLbs} lb used of {view.weightHeadroom.limitLbs} lb limit —{" "}
          <strong>{view.weightHeadroom.marginLbs} lb</strong> remaining.
        </p>
      </div>
      <div>
        <h2 style={{ marginTop: 0 }}>Power headroom</h2>
        <p className="app-muted" style={{ margin: 0 }}>
          {view.powerHeadroom.totalPeakAmps} A peak draw of {view.powerHeadroom.totalBreakerAmps} A breaker
          capacity — <strong>{view.powerHeadroom.headroomAmps} A</strong> remaining.
        </p>
      </div>
      <div>
        <h2 style={{ marginTop: 0 }}>Recent decisions</h2>
        {view.recentDecisions.length === 0 ? (
          <p className="app-muted">No decision log entries yet.</p>
        ) : (
          <ul className="factor-table" style={{ listStyle: "none", padding: 0, display: "grid", gap: 6 }}>
            {view.recentDecisions.map((decision) => (
              <li key={decision.id} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <span>{decision.title}</span>
                <small className="app-muted">
                  {decision.status}
                  {decision.decidedOn ? ` · ${decision.decidedOn}` : ""}
                </small>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function ReviewForm({
  busy,
  mutate,
}: {
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const empty = useMemo(
    () => ({
      subsystemName: "",
      title: "",
      proposal: "",
      category: "design" as DecisionCriticCategory,
      weightAddedLbs: "",
      powerAddedAmps: "",
    }),
    [],
  );
  const [form, setForm] = useState(empty);
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }));

  return (
    <Panel
      as="form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!form.subsystemName.trim() || !form.title.trim()) return;
        mutate({
          action: "log-review",
          subsystemName: form.subsystemName,
          title: form.title,
          proposal: form.proposal || undefined,
          category: form.category,
          weightAddedLbs: Number(form.weightAddedLbs) || 0,
          powerAddedAmps: Number(form.powerAddedAmps) || 0,
        });
        setForm(empty);
      }}
      style={{ display: "grid", gap: 10 }}
    >
      <h2 style={{ margin: 0 }}>Get a second opinion</h2>
      <FormGrid min={180}>
        <FormRow label="Subsystem">
          <input value={form.subsystemName} onChange={set("subsystemName")} placeholder="Climber" required />
        </FormRow>
        <FormRow label="Decision title">
          <input value={form.title} onChange={set("title")} placeholder="Add telescoping climber stage" required />
        </FormRow>
        <FormRow label="Category">
          <select value={form.category} onChange={set("category")}>
            {DECISION_CRITIC_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {CATEGORY_LABEL[category]}
              </option>
            ))}
          </select>
        </FormRow>
        <FormRow label="Weight added (lb)">
          <input type="number" min={0} step="0.1" value={form.weightAddedLbs} onChange={set("weightAddedLbs")} />
        </FormRow>
        <FormRow label="Power added (A)">
          <input type="number" min={0} step="0.1" value={form.powerAddedAmps} onChange={set("powerAddedAmps")} />
        </FormRow>
      </FormGrid>
      <FormRow label="Proposal details (optional)">
        <textarea value={form.proposal} onChange={set("proposal")} rows={2} />
      </FormRow>
      <div>
        <Button variant="primary" type="submit" disabled={busy || !form.subsystemName.trim() || !form.title.trim()}>
          Critique this decision
        </Button>
      </div>
    </Panel>
  );
}
