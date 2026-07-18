"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState, FormGrid, FormRow, PageHeader, Panel } from "../../components/ui";
import { riskCategoryLabel, riskLevelLabel, riskStatusLabel } from "../../lib/risks";
import { RISK_CATEGORIES, RISK_STATUSES, type RisksView } from "../../lib/risks/compute-risks";
import type { MatrixCell, RiskCategory, RiskEvaluation, RiskLevel, RiskStatus } from "../../lib/risks/types";

type LiveView = Extract<RisksView, { status: "live" }>;
type Mutate = (payload: Record<string, unknown>) => void;

const LEVEL_COLOR: Record<RiskLevel, string> = {
  low: "#2f9e57",
  moderate: "#c9a900",
  high: "#d9822b",
  critical: "#c02626",
};

const SCALES = [1, 2, 3, 4, 5];

export default function RisksClient() {
  const [view, setView] = useState<RisksView | null>(null);
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
    void fetch(`/api/risks${query.toString() ? `?${query.toString()}` : ""}`)
      .then(async (response) => {
        const data = (await response.json()) as RisksView | { error?: string };
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
      void fetch("/api/risks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId, seasonYear: season ?? undefined, ...payload }),
      })
        .then(async (response) => {
          const data = (await response.json()) as RisksView | { error?: string };
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
      <PageHeader
        breadcrumbs="Team / Risk Register"
        title="Risk Register"
        description={
          <>
            Identify what could derail your season — mechanism failures, schedule slips, funding gaps, driver
            availability — score each by likelihood and impact, assign a mitigation, and track it to closure.
          </>
        }
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

      {fetchFailed ? (
        <EmptyState
          title="Could not load the risk register"
          description="A network or server issue prevented loading. Try again."
        >
          <button type="button" className="app-button secondary" onClick={() => load()}>
            Retry
          </button>
        </EmptyState>
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
                <a href={step.href}>Open</a>
              </li>
            ))}
          </ol>
        </EmptyState>
      ) : (
        <div style={{ display: "grid", gap: 16 }}>
          <SummaryTiles view={view} />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16, alignItems: "start" }}>
            <RiskMatrix view={view} />
            <TopRisks view={view} />
          </div>
          <AddRiskForm busy={busy} mutate={mutate} />
          <RiskList view={view} busy={busy} mutate={mutate} />
        </div>
      )}
    </main>
  );
}

function SummaryTiles({ view }: { view: LiveView }) {
  const s = view.summary;
  const tiles = [
    { label: "Active risks", value: String(s.active) },
    { label: "Critical + high", value: String(s.byLevel.critical + s.byLevel.high) },
    { label: "Top score", value: String(s.highestScore) },
    { label: "Overdue", value: String(s.overdue.length) },
  ];
  return (
    <Panel>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: 12 }}>
        {tiles.map((tile) => (
          <div key={tile.label}>
            <strong style={{ fontSize: "1.6rem", display: "block" }}>{tile.value}</strong>
            <span className="app-muted">{tile.label}</span>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
        {(["critical", "high", "moderate", "low"] as RiskLevel[]).map((level) => (
          <span
            key={level}
            className="app-badge"
            style={{ background: LEVEL_COLOR[level], color: "#fff" }}
            title={`${s.byLevel[level]} active`}
          >
            {riskLevelLabel(level)}: {s.byLevel[level]}
          </span>
        ))}
      </div>
    </Panel>
  );
}

function RiskMatrix({ view }: { view: LiveView }) {
  return (
    <Panel style={{ overflowX: "auto" }}>
      <h2 style={{ marginTop: 0 }}>Risk matrix</h2>
      <div style={{ display: "flex", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center" }}>
          <span className="app-muted" style={{ writingMode: "vertical-rl", transform: "rotate(180deg)", fontSize: "0.75rem" }}>
            Impact →
          </span>
        </div>
        <div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 44px)", gap: 4 }}>
            {view.matrix.map((cell: MatrixCell) => (
              <div
                key={`${cell.likelihood}-${cell.impact}`}
                title={`Likelihood ${cell.likelihood} × Impact ${cell.impact} = ${cell.score} (${riskLevelLabel(cell.level)})`}
                style={{
                  height: 44,
                  borderRadius: 6,
                  background: LEVEL_COLOR[cell.level],
                  opacity: cell.count > 0 ? 1 : 0.28,
                  color: "#fff",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontWeight: 700,
                  fontSize: "0.95rem",
                }}
              >
                {cell.count > 0 ? cell.count : ""}
              </div>
            ))}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 44px)", gap: 4, marginTop: 4 }}>
            {SCALES.map((n) => (
              <span key={n} className="app-muted" style={{ textAlign: "center", fontSize: "0.75rem" }}>
                {n}
              </span>
            ))}
          </div>
          <div className="app-muted" style={{ textAlign: "center", fontSize: "0.75rem", marginTop: 2 }}>
            Likelihood →
          </div>
        </div>
      </div>
    </Panel>
  );
}

function TopRisks({ view }: { view: LiveView }) {
  if (view.summary.topRisks.length === 0) {
    return (
      <Panel>
        <h2 style={{ marginTop: 0 }}>Top risks</h2>
        <p className="app-muted">No active risks logged yet.</p>
      </Panel>
    );
  }
  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>Top risks</h2>
      <ol style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 6 }}>
        {view.summary.topRisks.map((evaluation) => (
          <li key={evaluation.risk.id}>
            <strong>{evaluation.risk.title}</strong>{" "}
            <span
              className="app-badge"
              style={{ background: LEVEL_COLOR[evaluation.level], color: "#fff" }}
            >
              {evaluation.score}
            </span>
            <small className="app-muted"> · {riskCategoryLabel(evaluation.risk.category)}</small>
            {evaluation.overdue ? <small style={{ color: "#c02626" }}> · mitigation overdue</small> : null}
          </li>
        ))}
      </ol>
    </Panel>
  );
}

function AddRiskForm({ busy, mutate }: { busy: boolean; mutate: Mutate }) {
  const empty = useMemo(
    () => ({ title: "", category: "technical" as RiskCategory, likelihood: "3", impact: "3", owner: "", mitigation: "" }),
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
        if (!form.title.trim()) return;
        mutate({
          action: "create-risk",
          title: form.title,
          category: form.category,
          likelihood: form.likelihood,
          impact: form.impact,
          owner: form.owner || undefined,
          mitigation: form.mitigation || undefined,
        });
        setForm(empty);
      }}
      style={{ display: "grid", gap: 10 }}
    >
      <h2 style={{ margin: 0 }}>Add risk</h2>
      <FormGrid min={130}>
        <FormRow label="Risk" wide>
          <input value={form.title} onChange={set("title")} placeholder="Climber winch could fail under load" required />
        </FormRow>
        <FormRow label="Category">
          <select value={form.category} onChange={set("category")}>
            {RISK_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {riskCategoryLabel(category)}
              </option>
            ))}
          </select>
        </FormRow>
        <FormRow label="Likelihood (1–5)">
          <select value={form.likelihood} onChange={set("likelihood")}>
            {SCALES.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </FormRow>
        <FormRow label="Impact (1–5)">
          <select value={form.impact} onChange={set("impact")}>
            {SCALES.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </FormRow>
        <FormRow label="Owner (optional)">
          <input value={form.owner} onChange={set("owner")} />
        </FormRow>
        <FormRow label="Mitigation (optional)" wide>
          <input value={form.mitigation} onChange={set("mitigation")} placeholder="Add a redundant ratchet; test to 1.5× load" />
        </FormRow>
      </FormGrid>
      <div>
        <button type="submit" className="app-button" disabled={busy || !form.title.trim()}>
          Add risk
        </button>
      </div>
    </Panel>
  );
}

function RiskList({ view, busy, mutate }: { view: LiveView; busy: boolean; mutate: Mutate }) {
  if (view.evaluations.length === 0) {
    return (
      <EmptyState
        badge="No risks yet"
        badgeTone="setup"
        title="Start your risk register"
        description="Add the things that could go wrong this season — the earlier you name them, the cheaper they are to mitigate."
      />
    );
  }
  return (
    <section style={{ display: "grid", gap: 12 }}>
      {view.evaluations.map((evaluation) => (
        <RiskCard key={evaluation.risk.id} evaluation={evaluation} busy={busy} mutate={mutate} />
      ))}
    </section>
  );
}

function RiskCard({ evaluation, busy, mutate }: { evaluation: RiskEvaluation; busy: boolean; mutate: Mutate }) {
  const { risk, score, level, overdue, daysToDue } = evaluation;
  const dimmed = risk.status === "closed";
  return (
    <Panel as="article" style={{ opacity: dimmed ? 0.6 : 1 }}>
      <header style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
        <div>
          <span className="app-badge" style={{ background: LEVEL_COLOR[level], color: "#fff" }}>
            {riskLevelLabel(level)} · {score}
          </span>{" "}
          <small className="app-muted">
            {riskCategoryLabel(risk.category)}
            {risk.owner ? ` · ${risk.owner}` : ""}
            {daysToDue != null
              ? overdue
                ? ` · ${Math.abs(daysToDue)}d overdue`
                : ` · due in ${daysToDue}d`
              : ""}
          </small>
          <h2 style={{ margin: "4px 0 0", fontSize: "1.1rem" }}>{risk.title}</h2>
          {risk.mitigation ? <p className="app-muted" style={{ margin: "6px 0 0" }}>Mitigation: {risk.mitigation}</p> : null}
        </div>
      </header>

      <footer style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 12 }}>
        <label className="app-muted" style={{ display: "flex", gap: 4, alignItems: "center" }}>
          L
          <select
            value={String(risk.likelihood)}
            disabled={busy}
            aria-label="Likelihood"
            onChange={(event) => mutate({ action: "update-risk", riskId: risk.id, likelihood: event.target.value })}
          >
            {SCALES.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label className="app-muted" style={{ display: "flex", gap: 4, alignItems: "center" }}>
          I
          <select
            value={String(risk.impact)}
            disabled={busy}
            aria-label="Impact"
            onChange={(event) => mutate({ action: "update-risk", riskId: risk.id, impact: event.target.value })}
          >
            {SCALES.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label className="app-muted" style={{ display: "flex", gap: 6, alignItems: "center" }}>
          Status
          <select
            value={risk.status}
            disabled={busy}
            onChange={(event) => mutate({ action: "update-risk", riskId: risk.id, status: event.target.value })}
          >
            {RISK_STATUSES.map((status) => (
              <option key={status} value={status}>
                {riskStatusLabel(status)}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="text-button"
          disabled={busy}
          onClick={() => {
            if (window.confirm(`Delete "${risk.title}"?`)) mutate({ action: "delete-risk", riskId: risk.id });
          }}
          style={{ marginLeft: "auto" }}
        >
          Delete
        </button>
      </footer>
    </Panel>
  );
}
