"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { OfflineBanner } from "../../components/offline-banner";
import { EmptyState, PageHeader, Button } from "../../components/ui";
import { hubHref } from "../../lib/nav/hubs";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../lib/offline/feature-cache";
import {
  ITEM_VERDICTS,
  REVIEW_STAGES,
  REVIEW_STATUSES,
  gateLabel,
  reviewStageLabel,
  reviewStatusLabel,
} from "../../lib/reviews";
import type { ReviewsView } from "../../lib/reviews/compute-reviews";
import type {
  GateDecision,
  ItemVerdict,
  ReviewEvaluation,
  ReviewStage,
  ReviewStatus,
} from "../../lib/reviews/types";
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

function isReviewsView(value: unknown): value is ReviewsView {
  if (!value || typeof value !== "object") return false;
  const status = (value as { status?: unknown }).status;
  return status === "setup_required" || status === "live";
}

function responseError(data: unknown): string {
  return data && typeof data === "object" && "error" in data && typeof data.error === "string"
    ? data.error
    : "";
}

function reviewsCacheOrg(data: ReviewsView, orgHint: string): string {
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

async function persistReviewsSnapshot(orgHint: string, seasonHint: string, data: ReviewsView): Promise<void> {
  const cacheOrg = reviewsCacheOrg(data, orgHint);
  if (!cacheOrg) return;
  const seasonKey = String(data.seasonYear);
  try {
    await putFeatureSnapshot("reviews", cacheOrg, data, seasonHint || seasonKey);
    if (!orgHint) await putFeatureSnapshot("reviews", "_", data, seasonHint || seasonKey);
  } catch {
    // Live Design reviews already painted; IndexedDB is best-effort.
  }
}

function ReviewsRelated({ orgId }: { orgId?: string | null }) {
  return (
    <nav className="product-hub-related" aria-label="Related build tools">
      <Button as="a" variant="secondary" href={hubHref("/build", "cad-vault", orgId)}>
        CAD vault
      </Button>
      <Button as="a" variant="secondary" href={hubHref("/build", "prototype", orgId)}>
        Prototypes
      </Button>
      <Button as="a" variant="secondary" href={hubHref("/build", "subsystems", orgId)}>
        Subsystem specs
      </Button>
    </nav>
  );
}

function ReviewsNextActions({ orgId }: { orgId: string }) {
  const actions = [
    {
      id: "schedule",
      label: "Schedule a review",
      detail: "Start from the standard checklist, then tailor the blockers.",
      href: "#reviews-add",
      primary: true,
    },
    {
      id: "vault",
      label: "Open CAD vault",
      detail: "The files under review live with the printable parts.",
      href: hubHref("/build", "cad-vault", orgId),
      primary: false,
    },
    {
      id: "prototypes",
      label: "Open Prototypes",
      detail: "A review gate should match a real prototype decision.",
      href: hubHref("/build", "prototype", orgId),
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

export default function ReviewsClient() {
  const [view, setView] = useState<ReviewsView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  // Kept so an expired session offers sign-in instead of a Retry that cannot work.
  const [failureStatus, setFailureStatus] = useState<number | null>(null);
  const [failureMessage, setFailureMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [season, setSeason] = useState<number | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const viewRef = useRef<ReviewsView | null>(null);
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
      const cached = await getFeatureSnapshot<ReviewsView>("reviews", orgHint || "_", seasonHint);
      if (!viewRef.current && cached?.data && isReviewsView(cached.data)) {
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
    setFailureStatus(null);
    setFailureMessage("");
    setError("");
    try {
      const query = new URLSearchParams();
      if (orgHint) query.set("orgId", orgHint);
      if (seasonQuery) query.set("season", String(seasonQuery));
      const response = await fetch(`/api/reviews${query.toString() ? `?${query.toString()}` : ""}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
      });
      const data: unknown = await response.json().catch(() => null);
      if (response.status === 401 || response.status === 403) {
        setView(null);
        setFromCache(false);
        setCachedAt(null);
        setFetchFailed(true);
        setFailureStatus(response.status);
        setFailureMessage(responseError(data));
        return;
      }
      if (!response.ok || !isReviewsView(data)) {
        if (hadCache || viewRef.current) {
          setFromCache(true);
          setError("Could not refresh Design reviews. Showing the last copy on this device.");
          setFetchFailed(false);
          return;
        }
        setFetchFailed(true);
        setFailureStatus(response.status);
        setFailureMessage(responseError(data));
        return;
      }
      setView(data);
      setSeason(data.seasonYear);
      setFromCache(false);
      setCachedAt(null);
      await persistReviewsSnapshot(orgHint, seasonHint, data);
    } catch {
      if (hadCache || viewRef.current) {
        setFromCache(true);
        setError("Could not refresh Design reviews. Showing the last copy on this device.");
        setFetchFailed(false);
        return;
      }
      setFetchFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
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
        signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
      })
        .then(async (response) => {
          const data: unknown = await response.json().catch(() => null);
          if (!response.ok || !isReviewsView(data)) {
            setError(responseError(data) || "Something went wrong.");
            return;
          }
          setView(data);
          setSeason(data.seasonYear);
          setFromCache(false);
          void persistReviewsSnapshot(orgId, String(data.seasonYear), data);
        })
        .catch(() => setError("Network error — please try again."))
        .finally(() => setBusy(false));
    },
    [orgId, season, busy],
  );

  const buildHref = orgId ? `/build?orgId=${encodeURIComponent(orgId)}` : "/build";
  const header = (
    <PageHeader
      breadcrumbs={
        <>
          <a href={buildHref}>Build</a>
          {" / Design reviews"}
        </>
      }
      title="Design reviews"
      description="Run concept, preliminary, critical, and final design reviews with a criteria checklist. The gate — go, conditional, or no-go — is computed from your verdicts, so nothing ships on a failed blocker by accident."
    >
      <ReviewsRelated orgId={orgId} />
      {view?.status === "live" && view.seasons.length > 0 ? (
        <label className="app-muted" style={{ display: "flex", gap: 6, alignItems: "center" }}>
          Season
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
    const failure = fetchFailed
      ? loadFailureCopy(
          classifyLoadFailure({
            status: failureStatus,
            message: failureMessage,
            online: typeof navigator === "undefined" ? true : navigator.onLine,
          }),
          {
            nextPath:
              typeof window === "undefined"
                ? null
                : `${window.location.pathname}${window.location.search}`,
            message: failureMessage || "A network or server issue prevented loading. Try again.",
          },
        )
      : null;
    return (
      <main className="module-page">
        {header}
        <OfflineBanner feature="Design reviews" fromCache={fromCache} cachedAt={cachedAt} />
        <EmptyState
          title={failure ? failure.title : "Loading…"}
          description={failure ? failure.description : "Checking your team."}
          aria-busy={!fetchFailed}
        >
          {failure?.primary ? (
            <Button as="a" variant="primary" href={failure.primary.href}>
              {failure.primary.label}
            </Button>
          ) : null}
          {failure?.showRetry ? (
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
          <OfflineBanner feature="Design reviews" fromCache={fromCache} cachedAt={cachedAt} />
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
      <OfflineBanner feature="Design reviews" fromCache={fromCache} cachedAt={cachedAt} />
      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}
      <ReviewsNextActions orgId={view.orgId} />
      <div style={{ display: "grid", gap: 16 }}>
        <SummaryTiles view={view} />
        {view.summary.needsAttention.length > 0 ? <NeedsAttention view={view} /> : null}
        <AddReviewForm busy={busy} mutate={mutate} />
        <ReviewList view={view} busy={busy} mutate={mutate} />
      </div>
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
      id="reviews-add"
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
        <Button variant="primary" type="submit" disabled={busy || !form.title.trim()}>
          Create review
        </Button>
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
        <Button variant="secondary" type="submit" disabled={busy || !criterion.trim()}>
          Add
        </Button>
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
