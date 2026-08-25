"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ITEM_VERDICTS, REVIEW_STAGES, REVIEW_STATUSES, gateLabel, reviewStageLabel, reviewStatusLabel } from "../../lib/reviews";
import type { ReviewsView } from "../../lib/reviews/compute-reviews";
import type { GateDecision, ItemVerdict, ReviewEvaluation, ReviewStage, ReviewStatus } from "../../lib/reviews/types";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";

type LiveView = Extract<ReviewsView, { status: "live" }>;
type Mutate = (payload: Record<string, unknown>) => void;

const GATE_COLOR: Record<GateDecision, string> = {
  go: "#1f7a3d",
  conditional: "#b26a00",
  no_go: "#c02626",
  pending: "#8a8f98",
};

const VERDICT_LABEL: Record<ItemVerdict, string> = { pending: "Pending", pass: "Pass", fail: "Fail", na: "N/A" };

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export default function ReviewsClient() {
  const [view, setView] = useState<ReviewsView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  // Kept so an expired session offers sign-in instead of a Retry that cannot work.
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false);
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
    void fetch(`/api/reviews${query.toString() ? `?${query.toString()}` : ""}`)
      .then(async (response) => {
        const data = (await response.json()) as ReviewsView | { error?: string };
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

  const mutate = useCallback<Mutate>(
    (payload) => {
      if (!orgId || busy) return;
      setBusy(true);
      setError("");
      void fetch("/api/reviews", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId, seasonYear: season ?? undefined, ...payload }),
      })
        .then(async (response) => {
          const data = (await response.json()) as ReviewsView | { error?: string };
          if (!response.ok || !("status" in data)) {
            setError("error" in data && data.error ? data.error : "Something went wrong.");
            return;
          }
          setView(data);
          setSeason(data.seasonYear);
        })
        .catch(() => setError("Network error — please try again."))
        .finally(() => setBusy(false));
    },
    [orgId, season, busy],
  );

  return (
    <main className="module-page">
      <header className="app-page-header">
        <div>
          <span className="breadcrumbs">Build / Design Reviews</span>
          <h1>Design Reviews</h1>
          <p>
            Run concept, preliminary, critical, and final design reviews with a criteria checklist. The gate — go,
            conditional, or no-go — is computed from your verdicts, so nothing ships on a failed blocker by accident.
          </p>
        </div>
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
      </header>

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

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
            <section className="app-card soft-panel">
              <h2>{copy.title}</h2>
              <p className="app-muted">{copy.description}</p>
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
            </section>
          );
        })()
      ) : view == null ? (
        <section className="app-card soft-panel">
          <h2>Loading…</h2>
          <p className="app-muted">Checking your workspace.</p>
        </section>
      ) : view.status === "setup_required" ? (
        <section className="app-card soft-panel">
          <span className="app-badge setup">Setup required</span>
          <h2>{view.message}</h2>
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
        </section>
      ) : (
        <div style={{ display: "grid", gap: 16 }}>
          <SummaryTiles view={view} />
          {view.summary.needsAttention.length > 0 ? <NeedsAttention view={view} /> : null}
          <AddReviewForm busy={busy} mutate={mutate} />
          <ReviewList view={view} busy={busy} mutate={mutate} />
        </div>
      )}
    </main>
  );
}

function SummaryTiles({ view }: { view: LiveView }) {
  const s = view.summary;
  return (
    <section className="app-card soft-panel">
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: 12 }}>
        <div>
          <strong style={{ fontSize: "1.6rem", display: "block" }}>{s.total}</strong>
          <span className="app-muted">Reviews</span>
        </div>
        <div>
          <strong style={{ fontSize: "1.6rem", display: "block" }}>{pct(s.avgReadiness)}</strong>
          <span className="app-muted">Avg readiness</span>
        </div>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
        {(["go", "conditional", "no_go", "pending"] as GateDecision[]).map((gate) => (
          <span key={gate} className="app-badge" style={{ background: GATE_COLOR[gate], color: "#fff" }}>
            {gateLabel(gate)}: {s.byGate[gate]}
          </span>
        ))}
      </div>
    </section>
  );
}

function NeedsAttention({ view }: { view: LiveView }) {
  return (
    <section className="app-card soft-panel" style={{ borderLeft: "3px solid #c02626" }}>
      <h2 style={{ marginTop: 0 }}>Needs attention</h2>
      <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 6 }}>
        {view.summary.needsAttention.map((evaluation) => (
          <li key={evaluation.review.id}>
            <strong>{evaluation.review.title}</strong>
            <span style={{ color: GATE_COLOR[evaluation.gate] }}> · {gateLabel(evaluation.gate)}</span>
            <small className="app-muted">
              {" "}
              · {reviewStageLabel(evaluation.review.stage)} · {evaluation.review.subsystem}
              {evaluation.blockingFails > 0 ? ` · ${evaluation.blockingFails} blocker(s) failing` : ""}
              {evaluation.pending > 0 ? ` · ${evaluation.pending} pending` : ""}
            </small>
          </li>
        ))}
      </ul>
    </section>
  );
}

function AddReviewForm({ busy, mutate }: { busy: boolean; mutate: Mutate }) {
  const empty = useMemo(
    () => ({ title: "", subsystem: "", stage: "critical" as ReviewStage, scheduledOn: "", reviewers: "", seed: true }),
    [],
  );
  const [form, setForm] = useState(empty);
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }));

  return (
    <form
      className="app-card soft-panel"
      onSubmit={(event) => {
        event.preventDefault();
        if (!form.title.trim()) return;
        mutate({
          action: "create-review",
          title: form.title,
          subsystem: form.subsystem || undefined,
          stage: form.stage,
          scheduledOn: form.scheduledOn || undefined,
          reviewers: form.reviewers || undefined,
          seedChecklist: form.seed,
        });
        setForm(empty);
      }}
      style={{ display: "grid", gap: 10 }}
    >
      <h2 style={{ margin: 0 }}>Schedule a review</h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10 }}>
        <label style={{ display: "grid", gap: 4, gridColumn: "1 / -1" }}>
          <span className="app-muted">Review title</span>
          <input value={form.title} onChange={set("title")} placeholder="Intake critical design review" required />
        </label>
        <label style={{ display: "grid", gap: 4 }}>
          <span className="app-muted">Subsystem</span>
          <input value={form.subsystem} onChange={set("subsystem")} placeholder="intake" />
        </label>
        <label style={{ display: "grid", gap: 4 }}>
          <span className="app-muted">Stage</span>
          <select value={form.stage} onChange={set("stage")}>
            {REVIEW_STAGES.map((stage) => (
              <option key={stage} value={stage}>
                {reviewStageLabel(stage)}
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: "grid", gap: 4 }}>
          <span className="app-muted">Date</span>
          <input type="date" value={form.scheduledOn} onChange={set("scheduledOn")} />
        </label>
        <label style={{ display: "grid", gap: 4 }}>
          <span className="app-muted">Reviewers</span>
          <input value={form.reviewers} onChange={set("reviewers")} placeholder="Lead mentor + design lead" />
        </label>
      </div>
      <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input type="checkbox" checked={form.seed} onChange={(e) => setForm((prev) => ({ ...prev, seed: e.target.checked }))} />
        <span className="app-muted">Start from the standard {reviewStageLabel(form.stage).toLowerCase()} checklist</span>
      </label>
      <div>
        <button type="submit" className="app-button" disabled={busy || !form.title.trim()}>
          Create review
        </button>
      </div>
    </form>
  );
}

function ReviewList({ view, busy, mutate }: { view: LiveView; busy: boolean; mutate: Mutate }) {
  if (view.evaluations.length === 0) {
    return (
      <section className="app-card soft-panel">
        <span className="app-badge setup">No reviews yet</span>
        <h2>Run your first design review</h2>
        <p className="app-muted">Schedule a review above; it starts from a standard checklist you can tailor.</p>
      </section>
    );
  }
  return (
    <section style={{ display: "grid", gap: 12 }}>
      {view.evaluations.map((evaluation) => (
        <ReviewCard key={evaluation.review.id} evaluation={evaluation} busy={busy} mutate={mutate} />
      ))}
    </section>
  );
}

function ReviewCard({ evaluation, busy, mutate }: { evaluation: ReviewEvaluation; busy: boolean; mutate: Mutate }) {
  const { review, gate, readiness, applicable, passed } = evaluation;
  const [criterion, setCriterion] = useState("");
  const [blocking, setBlocking] = useState(false);

  return (
    <article className="app-card soft-panel">
      <header style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
        <div>
          <span className="app-badge" style={{ background: GATE_COLOR[gate], color: "#fff" }}>
            {gateLabel(gate)}
          </span>{" "}
          <small className="app-muted">
            {reviewStageLabel(review.stage)} · {review.subsystem}
            {review.scheduledOn ? ` · ${review.scheduledOn}` : ""}
            {review.reviewers ? ` · ${review.reviewers}` : ""}
          </small>
          <h2 style={{ margin: "4px 0 0", fontSize: "1.1rem" }}>{review.title}</h2>
        </div>
        <div style={{ textAlign: "right" }}>
          <strong style={{ fontSize: "1.3rem" }}>{pct(readiness)}</strong>
          <small className="app-muted" style={{ display: "block" }}>{passed}/{applicable} pass</small>
        </div>
      </header>

      <div className="mini-probability" aria-hidden="true" style={{ margin: "10px 0" }}>
        <i style={{ width: `${Math.max(2, readiness * 100)}%`, background: GATE_COLOR[gate] }} />
      </div>

      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 6 }}>
        {review.items.map((item) => (
          <li key={item.id} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ flex: "1 1 200px" }}>
              {item.criterion}
              {item.blocking ? <em style={{ color: "#c02626" }}> · blocker</em> : null}
            </span>
            <select
              value={item.verdict}
              disabled={busy}
              aria-label={`Verdict for ${item.criterion}`}
              onChange={(event) => mutate({ action: "update-item", reviewId: review.id, itemId: item.id, verdict: event.target.value })}
            >
              {ITEM_VERDICTS.map((verdict) => (
                <option key={verdict} value={verdict}>
                  {VERDICT_LABEL[verdict]}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="app-badge demo"
              disabled={busy}
              title="Toggle go/no-go blocker"
              style={{ cursor: "pointer", border: "none" }}
              onClick={() => mutate({ action: "update-item", reviewId: review.id, itemId: item.id, blocking: !item.blocking })}
            >
              {item.blocking ? "Blocker" : "Not blocker"}
            </button>
            <button
              type="button"
              className="text-button"
              disabled={busy}
              aria-label={`Remove ${item.criterion}`}
              onClick={() => mutate({ action: "remove-item", reviewId: review.id, itemId: item.id })}
            >
              ×
            </button>
          </li>
        ))}
      </ul>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!criterion.trim()) return;
          mutate({ action: "add-item", reviewId: review.id, criterion, blocking });
          setCriterion("");
          setBlocking(false);
        }}
        style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap", marginTop: 10 }}
      >
        <label style={{ display: "grid", gap: 4, flex: "2 1 200px" }}>
          <span className="app-muted">Add criterion</span>
          <input value={criterion} onChange={(e) => setCriterion(e.target.value)} placeholder="Wiring strain-relieved" />
        </label>
        <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input type="checkbox" checked={blocking} onChange={(e) => setBlocking(e.target.checked)} />
          <span className="app-muted">Blocker</span>
        </label>
        <button type="submit" className="app-button secondary" disabled={busy || !criterion.trim()}>
          Add
        </button>
      </form>

      <footer style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 12 }}>
        <label className="app-muted" style={{ display: "flex", gap: 6, alignItems: "center" }}>
          Status
          <select
            value={review.status}
            disabled={busy}
            onChange={(event) => mutate({ action: "update-review", reviewId: review.id, status: event.target.value })}
          >
            {REVIEW_STATUSES.map((status: ReviewStatus) => (
              <option key={status} value={status}>
                {reviewStatusLabel(status)}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="text-button"
          disabled={busy}
          onClick={() => {
            if (window.confirm(`Delete "${review.title}"?`)) mutate({ action: "delete-review", reviewId: review.id });
          }}
          style={{ marginLeft: "auto" }}
        >
          Delete review
        </button>
      </footer>
    </article>
  );
}
