"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { decisionCategoryLabel, decisionStatusLabel } from "../../lib/decisions";
import { DECISION_CATEGORIES, DECISION_STATUSES, type DecisionsView } from "../../lib/decisions/compute-decisions";
import type { DecisionCategory, DecisionStatus, ResolvedDecision } from "../../lib/decisions/types";

type LiveView = Extract<DecisionsView, { status: "live" }>;
type Mutate = (payload: Record<string, unknown>) => void;

const STATUS_COLOR: Record<DecisionStatus, string> = {
  proposed: "#b26a00",
  accepted: "#1f7a3d",
  rejected: "#c02626",
  superseded: "#8a8f98",
};

export default function DecisionsClient() {
  const [view, setView] = useState<DecisionsView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [season, setSeason] = useState<number | null>(null);

  const orgId = view && "orgId" in view ? view.orgId : null;

  const load = useCallback((seasonOverride?: number) => {
    setFetchFailed(false);
    setError("");
    const params = new URLSearchParams(window.location.search);
    const urlOrg = params.get("orgId");
    const seasonQuery = seasonOverride ?? (params.get("season") ? Number(params.get("season")) : null);
    const query = new URLSearchParams();
    if (urlOrg) query.set("orgId", urlOrg);
    if (seasonQuery) query.set("season", String(seasonQuery));
    void fetch(`/api/decisions${query.toString() ? `?${query.toString()}` : ""}`)
      .then(async (response) => {
        const data = (await response.json()) as DecisionsView | { error?: string };
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

  const mutate = useCallback<Mutate>(
    (payload) => {
      if (!orgId || busy) return;
      setBusy(true);
      setError("");
      void fetch("/api/decisions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId, seasonYear: season ?? undefined, ...payload }),
      })
        .then(async (response) => {
          const data = (await response.json()) as DecisionsView | { error?: string };
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
          <span className="breadcrumbs">Team / Decision Log</span>
          <h1>Decision Log</h1>
          <p>
            Record the calls that shape your season — the context, the options you weighed, what you chose, and why.
            Institutional memory for next year&apos;s team, and exactly what judges look for.
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
        <section className="app-card soft-panel">
          <h2>Could not load the decision log</h2>
          <p className="app-muted">A network or server issue prevented loading. Try again.</p>
          <button type="button" className="app-button secondary" onClick={() => load()}>
            Retry
          </button>
        </section>
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
          {view.summary.open.length > 0 ? <OpenDecisions view={view} /> : null}
          <AddDecisionForm busy={busy} mutate={mutate} />
          <DecisionList view={view} busy={busy} mutate={mutate} />
        </div>
      )}
    </main>
  );
}

function SummaryTiles({ view }: { view: LiveView }) {
  const s = view.summary;
  const tiles = [
    { label: "Decisions", value: String(s.total) },
    { label: "Open (proposed)", value: String(s.byStatus.proposed) },
    { label: "Accepted", value: String(s.byStatus.accepted) },
    { label: "Superseded", value: String(s.supersededCount) },
  ];
  return (
    <section className="app-card soft-panel">
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: 12 }}>
        {tiles.map((tile) => (
          <div key={tile.label}>
            <strong style={{ fontSize: "1.6rem", display: "block" }}>{tile.value}</strong>
            <span className="app-muted">{tile.label}</span>
          </div>
        ))}
      </div>
      {s.byCategory.length > 0 ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
          {s.byCategory.map((row) => (
            <span key={row.category} className="app-badge demo">
              {decisionCategoryLabel(row.category)}: {row.count}
            </span>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function OpenDecisions({ view }: { view: LiveView }) {
  return (
    <section className="app-card soft-panel" style={{ borderLeft: "3px solid #b26a00" }}>
      <h2 style={{ marginTop: 0 }}>Awaiting a call</h2>
      <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 6 }}>
        {view.summary.open.map((decision) => (
          <li key={decision.id}>
            <strong>{decision.title}</strong>
            <small className="app-muted"> · {decisionCategoryLabel(decision.category)}</small>
            {decision.options.length > 0 ? (
              <small className="app-muted"> · {decision.options.length} option(s) on the table</small>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

function AddDecisionForm({ busy, mutate }: { busy: boolean; mutate: Mutate }) {
  const empty = useMemo(
    () => ({
      title: "",
      category: "design" as DecisionCategory,
      status: "proposed" as DecisionStatus,
      context: "",
      options: "",
      decision: "",
      rationale: "",
      deciders: "",
    }),
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
          action: "create-decision",
          title: form.title,
          category: form.category,
          status: form.status,
          context: form.context || undefined,
          options: form.options || undefined,
          decision: form.decision || undefined,
          rationale: form.rationale || undefined,
          deciders: form.deciders || undefined,
        });
        setForm(empty);
      }}
      style={{ display: "grid", gap: 10 }}
    >
      <h2 style={{ margin: 0 }}>Record a decision</h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
        <label style={{ display: "grid", gap: 4, gridColumn: "1 / -1" }}>
          <span className="app-muted">Decision</span>
          <input value={form.title} onChange={set("title")} placeholder="Swerve vs. tank drivetrain" required />
        </label>
        <label style={{ display: "grid", gap: 4 }}>
          <span className="app-muted">Category</span>
          <select value={form.category} onChange={set("category")}>
            {DECISION_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {decisionCategoryLabel(category)}
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: "grid", gap: 4 }}>
          <span className="app-muted">Status</span>
          <select value={form.status} onChange={set("status")}>
            {DECISION_STATUSES.filter((s) => s !== "superseded").map((status) => (
              <option key={status} value={status}>
                {decisionStatusLabel(status)}
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: "grid", gap: 4 }}>
          <span className="app-muted">Deciders (optional)</span>
          <input value={form.deciders} onChange={set("deciders")} placeholder="Design team + lead mentor" />
        </label>
      </div>
      <label style={{ display: "grid", gap: 4 }}>
        <span className="app-muted">Context — what problem / constraint?</span>
        <textarea value={form.context} onChange={set("context")} rows={2} />
      </label>
      <label style={{ display: "grid", gap: 4 }}>
        <span className="app-muted">Options considered (one per line)</span>
        <textarea value={form.options} onChange={set("options")} rows={2} placeholder={"Swerve\nWest-coast tank\nMecanum"} />
      </label>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
        <label style={{ display: "grid", gap: 4 }}>
          <span className="app-muted">Decision (if made)</span>
          <textarea value={form.decision} onChange={set("decision")} rows={2} />
        </label>
        <label style={{ display: "grid", gap: 4 }}>
          <span className="app-muted">Rationale</span>
          <textarea value={form.rationale} onChange={set("rationale")} rows={2} />
        </label>
      </div>
      <div>
        <button type="submit" className="app-button" disabled={busy || !form.title.trim()}>
          Record decision
        </button>
      </div>
    </form>
  );
}

function DecisionList({ view, busy, mutate }: { view: LiveView; busy: boolean; mutate: Mutate }) {
  if (view.decisions.length === 0) {
    return (
      <section className="app-card soft-panel">
        <span className="app-badge setup">No decisions yet</span>
        <h2>Start your decision log</h2>
        <p className="app-muted">Record your first big call — drivetrain, game strategy, a build tradeoff — with the reasoning behind it.</p>
      </section>
    );
  }
  return (
    <section style={{ display: "grid", gap: 12 }}>
      {view.decisions.map((decision) => (
        <DecisionCard key={decision.id} decision={decision} all={view.decisions} busy={busy} mutate={mutate} />
      ))}
    </section>
  );
}

function DecisionCard({
  decision,
  all,
  busy,
  mutate,
}: {
  decision: ResolvedDecision;
  all: ResolvedDecision[];
  busy: boolean;
  mutate: Mutate;
}) {
  const color = STATUS_COLOR[decision.effectiveStatus];
  const supersedeOptions = all.filter((d) => d.id !== decision.id);
  return (
    <article className="app-card soft-panel" style={{ opacity: decision.effectiveStatus === "superseded" ? 0.7 : 1 }}>
      <header style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
        <div>
          <span className="app-badge" style={{ background: color, color: "#fff" }}>
            {decisionStatusLabel(decision.effectiveStatus)}
          </span>{" "}
          <small className="app-muted">
            {decisionCategoryLabel(decision.category)}
            {decision.decidedOn ? ` · ${decision.decidedOn}` : ""}
            {decision.deciders ? ` · ${decision.deciders}` : ""}
          </small>
          <h2 style={{ margin: "4px 0 0", fontSize: "1.15rem" }}>{decision.title}</h2>
        </div>
      </header>

      {decision.supersededByTitle ? (
        <p className="app-muted" style={{ margin: "8px 0 0" }}>↳ Replaced by <strong>{decision.supersededByTitle}</strong></p>
      ) : null}

      {decision.context ? (
        <p style={{ margin: "8px 0 0" }}>
          <span className="app-muted">Context: </span>
          {decision.context}
        </p>
      ) : null}
      {decision.options.length > 0 ? (
        <div style={{ margin: "8px 0 0" }}>
          <span className="app-muted">Options considered:</span>
          <ul style={{ margin: "2px 0 0", paddingLeft: 18 }}>
            {decision.options.map((option) => (
              <li key={option}>{option}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {decision.decision ? (
        <p style={{ margin: "8px 0 0" }}>
          <span className="app-muted">Decision: </span>
          <strong>{decision.decision}</strong>
        </p>
      ) : null}
      {decision.rationale ? (
        <p style={{ margin: "8px 0 0" }}>
          <span className="app-muted">Why: </span>
          {decision.rationale}
        </p>
      ) : null}

      <footer style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 12 }}>
        <label className="app-muted" style={{ display: "flex", gap: 6, alignItems: "center" }}>
          Status
          <select
            value={decision.status}
            disabled={busy}
            onChange={(event) => mutate({ action: "update-decision", decisionId: decision.id, status: event.target.value })}
          >
            {DECISION_STATUSES.map((status) => (
              <option key={status} value={status}>
                {decisionStatusLabel(status)}
              </option>
            ))}
          </select>
        </label>
        <label className="app-muted" style={{ display: "flex", gap: 6, alignItems: "center" }}>
          Supersedes
          <select
            value={decision.supersedesId ?? ""}
            disabled={busy}
            onChange={(event) => mutate({ action: "update-decision", decisionId: decision.id, supersedesId: event.target.value })}
          >
            <option value="">—</option>
            {supersedeOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.title.slice(0, 40)}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="text-button"
          disabled={busy}
          onClick={() => {
            if (window.confirm(`Delete "${decision.title}"?`)) mutate({ action: "delete-decision", decisionId: decision.id });
          }}
          style={{ marginLeft: "auto" }}
        >
          Delete
        </button>
      </footer>
    </article>
  );
}
