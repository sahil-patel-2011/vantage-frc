"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState, FormGrid, FormRow, PageHeader, Panel } from "../../components/ui";
import { TeamHubRelated } from "../../components/team-hub-related";
import { riskCategoryLabel, riskLevelLabel, riskStatusLabel } from "../../lib/risks";
import { RISK_CATEGORIES, RISK_STATUSES, type RisksView } from "../../lib/risks/compute-risks";
import {
  RISKS_TEAM_RELATED_INCLUDE,
  formatLikelihoodImpact,
  formatRiskScoreDisplay,
  risksNextActions,
  risksRelatedLinks,
} from "../../lib/risks/risks-related";
import type { MatrixCell, RiskCategory, RiskEvaluation, RiskLevel, RiskStatus } from "../../lib/risks/types";
import { hubHref } from "../../lib/nav/hubs";
import { withOrgHref } from "../../lib/nav/product-nav";
import "./risks.css";

type LiveView = Extract<RisksView, { status: "live" }>;
type Mutate = (payload: Record<string, unknown>) => void;

const SCALES = [1, 2, 3, 4, 5];

function RisksRelated({ orgId }: { orgId: string }) {
  const primary = risksRelatedLinks(orgId, { include: ["fmea", "knowledge", "batteries"] });
  return (
    <div className="risks-related">
      <nav className="product-hub-related risks-hub-related" aria-label="Related reliability tools">
        {primary.map((link) => (
          <a key={link.id} className="app-button secondary" href={link.href}>
            {link.label}
          </a>
        ))}
      </nav>
      <TeamHubRelated orgId={orgId} include={[...RISKS_TEAM_RELATED_INCLUDE]} />
    </div>
  );
}

function NextActions({
  orgId,
  riskCount,
  activeCount,
  overdueCount,
  highestScore,
  topTitle,
}: {
  orgId?: string | null;
  riskCount: number;
  activeCount: number;
  overdueCount: number;
  highestScore: number;
  topTitle?: string | null;
}) {
  const actions = risksNextActions({
    orgId,
    riskCount,
    activeCount,
    overdueCount,
    highestScore,
    topTitle,
  });
  return (
    <section className="risks-next-actions app-card soft-panel" aria-label="Next actions">
      <header>
        <h2>Next actions</h2>
        <p>Prioritized from logged season risks — scores stay blank until you enter real L×I.</p>
      </header>
      <ol>
        {actions.map((action) => (
          <li key={action.id} className={action.primary ? "primary" : undefined}>
            <div>
              <strong>{action.label}</strong>
              <span>{action.detail}</span>
            </div>
            <a className="app-button secondary" href={action.href}>
              Open
            </a>
          </li>
        ))}
      </ol>
    </section>
  );
}

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

  if (fetchFailed || view == null) {
    return (
      <main className="module-page risks-page">
        <PageHeader
          breadcrumbs="Team / Risk Register"
          title="Risk Register"
          description="Proactive season risks scored with real likelihood × impact — never demo scores. Distinct from FMEA failure logging."
        />
        <EmptyState
          soft
          title={fetchFailed ? "Could not load the risk register" : "Loading risk register…"}
          description={
            fetchFailed
              ? "A network or server issue prevented loading. Try again."
              : "Checking your workspace."
          }
          aria-busy={!fetchFailed}
        >
          {fetchFailed ? (
            <button type="button" className="app-button secondary" onClick={() => load()}>
              Retry
            </button>
          ) : null}
        </EmptyState>
      </main>
    );
  }

  if (view.status === "setup_required") {
    return (
      <main className="module-page risks-page">
        <PageHeader
          breadcrumbs="Team / Risk Register"
          title="Risk Register"
          description="Identify what could derail the season — score likelihood × impact, assign mitigations, and track closure. Separate from FMEA’s O×S×D failure log."
        />
        <EmptyState soft badge="Setup required" badgeTone="setup" title={view.message}>
          <ol className="risks-setup-steps">
            {view.steps.map((step) => (
              <li key={step.id}>
                <div>
                  <strong>{step.label}</strong>
                  <span>{step.detail}</span>
                </div>
                <a className="app-button secondary" href={step.href}>
                  Open
                </a>
              </li>
            ))}
          </ol>
        </EmptyState>
        <NextActions
          orgId={view.orgId}
          riskCount={0}
          activeCount={0}
          overdueCount={0}
          highestScore={0}
        />
      </main>
    );
  }

  const hasRisks = view.evaluations.length > 0;
  const topTitle = view.summary.topRisks[0]?.risk.title ?? null;

  return (
    <main className="module-page risks-page">
      <PageHeader
        breadcrumbs="Team / Risk Register"
        title="Risk Register"
        description={
          <>
            Identify what could derail your season — mechanism failures, schedule slips, funding gaps,
            driver availability. Score each by likelihood × impact from real entries only — never demo
            numbers. For things that already broke, use FMEA.
          </>
        }
      >
        <div className="risks-header-actions">
          {view.seasons.length > 0 ? (
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
          <a className="app-button secondary" href={hubHref("/team", "fmea", orgId)}>
            FMEA
          </a>
          <a className="app-button secondary" href={hubHref("/team", "knowledge", orgId)}>
            Knowledge
          </a>
          <a className="app-button secondary" href={withOrgHref("/subsystems", orgId)}>
            Subsystems
          </a>
        </div>
      </PageHeader>

      {orgId ? <RisksRelated orgId={orgId} /> : null}

      {error ? (
        <p className="risks-alert" role="alert">
          {error}
        </p>
      ) : null}

      <NextActions
        orgId={orgId}
        riskCount={view.summary.total}
        activeCount={view.summary.active}
        overdueCount={view.summary.overdue.length}
        highestScore={view.summary.highestScore}
        topTitle={topTitle}
      />

      <SummaryTiles view={view} />
      <BatteryReliabilitySignals view={view} />

      {!hasRisks ? (
        <EmptyState
          soft
          title="No season risks logged yet"
          description="Add schedule, technical, funding, or people risks with real L×I scores. Top score stays blank until then — nothing is invented. FMEA is for failures that already happened."
        >
          <div className="risks-row-links">
            <a href={hubHref("/team", "fmea", orgId)}>FMEA →</a>
            <a href={hubHref("/team", "knowledge", orgId)}>Knowledge →</a>
            <a href={withOrgHref("/subsystems", orgId)}>Subsystems →</a>
          </div>
        </EmptyState>
      ) : (
        <div className="risks-layout">
          <RiskMatrix view={view} />
          <TopRisks view={view} />
        </div>
      )}

      <AddRiskForm busy={busy} mutate={mutate} />
      {hasRisks ? <RiskList view={view} busy={busy} mutate={mutate} orgId={orgId} /> : null}
    </main>
  );
}

function BatteryReliabilitySignals({ view }: { view: LiveView }) {
  if (!view.batterySignals?.length) return null;
  return (
    <Panel className="risks-panel">
      <h2>Battery reliability signals</h2>
      <p>From the canonical battery fleet — promote into this register when the failure mode is season-relevant. Not invented rows.</p>
      <ul className="risks-battery-signals">
        {view.batterySignals.map((signal) => (
          <li key={signal.id}>
            <strong>{signal.title}</strong>
            <span className="meta">
              L{signal.likelihood} × I{signal.impact} · {signal.category}
            </span>
            <span>{signal.detail}</span>
            <a href={signal.href}>Open Batteries</a>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function SummaryTiles({ view }: { view: LiveView }) {
  const s = view.summary;
  const hasActive = s.active > 0;
  const hot = s.byLevel.critical + s.byLevel.high;
  const tiles = [
    { label: "Active risks", value: String(s.active), tone: s.active > 0 ? "warn" : "" },
    { label: "Critical + high", value: String(hot), tone: hot > 0 ? "critical" : "" },
    { label: "Top score", value: formatRiskScoreDisplay(s.highestScore, hasActive), tone: "" },
    { label: "Overdue", value: String(s.overdue.length), tone: s.overdue.length > 0 ? "warn" : "" },
  ];
  return (
    <Panel>
      <section className="risks-summary" aria-label="Season risk summary">
        {tiles.map((tile) => (
          <article key={tile.label} className={`risks-summary-tile${tile.tone ? ` ${tile.tone}` : ""}`}>
            <strong>{tile.value}</strong>
            <span>{tile.label}</span>
          </article>
        ))}
      </section>
      {hasActive ? (
        <div className="risks-level-row">
          {(["critical", "high", "moderate", "low"] as RiskLevel[]).map((level) => (
            <span key={level} className={`risks-badge ${level}`} title={`${s.byLevel[level]} active`}>
              {riskLevelLabel(level)}: {s.byLevel[level]}
            </span>
          ))}
        </div>
      ) : null}
    </Panel>
  );
}

function RiskMatrix({ view }: { view: LiveView }) {
  return (
    <Panel className="risks-panel" style={{ overflowX: "auto" }}>
      <h2>Risk matrix</h2>
      <p>Counts of active risks only — empty cells stay dim; no demo placements.</p>
      <div className="risks-matrix-wrap">
        <div className="risks-matrix-axis">
          <span>Impact →</span>
        </div>
        <div>
          <div className="risks-matrix" role="img" aria-label="5 by 5 likelihood by impact matrix">
            {view.matrix.map((cell: MatrixCell) => (
              <div
                key={`${cell.likelihood}-${cell.impact}`}
                title={`Likelihood ${cell.likelihood} × Impact ${cell.impact} = ${cell.score} (${riskLevelLabel(cell.level)})`}
                className={`risks-matrix-cell ${cell.level}${cell.count > 0 ? "" : " empty"}`}
              >
                {cell.count > 0 ? cell.count : ""}
              </div>
            ))}
          </div>
          <div className="risks-matrix-labels">
            {SCALES.map((n) => (
              <span key={n}>{n}</span>
            ))}
          </div>
          <div className="risks-matrix-caption">Likelihood →</div>
        </div>
      </div>
    </Panel>
  );
}

function TopRisks({ view }: { view: LiveView }) {
  if (view.summary.topRisks.length === 0) {
    return (
      <Panel className="risks-panel">
        <h2>Top risks</h2>
        <p>No active risks — top score stays blank. No demo ranking is shown.</p>
      </Panel>
    );
  }
  return (
    <Panel className="risks-panel">
      <h2>Top risks</h2>
      <ol className="risks-top-list">
        {view.summary.topRisks.map((evaluation) => (
          <li key={evaluation.risk.id}>
            <div className="who">
              <strong>{evaluation.risk.title}</strong>
              <span className={`risks-badge ${evaluation.level}`}>{evaluation.score}</span>
            </div>
            <div className="meta">
              {riskCategoryLabel(evaluation.risk.category)} · {formatLikelihoodImpact(evaluation.risk)}
              {evaluation.overdue ? " · mitigation overdue" : ""}
            </div>
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

  const previewScore = Number(form.likelihood) * Number(form.impact);

  return (
    <Panel
      as="form"
      className="risks-panel"
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
    >
      <h2>Add risk</h2>
      <p>Proactive season risk — not an FMEA failure. Score will be L×I from the values you set.</p>
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
      <div className="risks-form-actions">
        <button type="submit" className="app-button" disabled={busy || !form.title.trim()}>
          Add risk
        </button>
        {form.title.trim() ? (
          <span className="risks-preview">
            Preview score <strong>{previewScore}</strong> ({formatLikelihoodImpact({ likelihood: Number(form.likelihood), impact: Number(form.impact) })})
          </span>
        ) : null}
      </div>
    </Panel>
  );
}

function RiskList({
  view,
  busy,
  mutate,
  orgId,
}: {
  view: LiveView;
  busy: boolean;
  mutate: Mutate;
  orgId: string | null;
}) {
  return (
    <section className="risks-list" aria-label="Season risks">
      {view.evaluations.map((evaluation) => (
        <RiskCard key={evaluation.risk.id} evaluation={evaluation} busy={busy} mutate={mutate} orgId={orgId} />
      ))}
    </section>
  );
}

function RiskCard({
  evaluation,
  busy,
  mutate,
  orgId,
}: {
  evaluation: RiskEvaluation;
  busy: boolean;
  mutate: Mutate;
  orgId: string | null;
}) {
  const { risk, score, level, overdue, daysToDue } = evaluation;
  const rowClass = [
    "risks-row",
    level,
    risk.status === "closed" ? "closed" : "",
    overdue ? "overdue" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <article className={rowClass}>
      <header className="risks-row-top">
        <div className="risks-row-title">
          <strong>{risk.title}</strong>
          <div className="risks-row-meta">
            <span className={`risks-badge ${level}`}>{riskLevelLabel(level)}</span>
            <span>{riskCategoryLabel(risk.category)}</span>
            {risk.owner ? <span>{risk.owner}</span> : null}
            {daysToDue != null ? (
              overdue ? (
                <span className="risks-badge overdue">{Math.abs(daysToDue)}d overdue</span>
              ) : (
                <span>due in {daysToDue}d</span>
              )
            ) : null}
          </div>
        </div>
        <div className="risks-row-scores">
          <span className="risks-li">{formatLikelihoodImpact(risk)}</span>
          <span className="risks-score">
            <em>Score</em>
            <strong>{score}</strong>
          </span>
        </div>
      </header>

      <div className="risks-row-body">
        {risk.mitigation ? (
          <p>
            <span className="label">Mitigation: </span>
            {risk.mitigation}
          </p>
        ) : (
          <p className="warn">No mitigation recorded yet.</p>
        )}
        <div className="risks-row-links">
          <a href={hubHref("/team", "fmea", orgId)}>Log in FMEA if it fails →</a>
          <a href={hubHref("/team", "knowledge", orgId)}>Document in Knowledge →</a>
        </div>
      </div>

      <footer className="risks-row-actions">
        <label>
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
        <label>
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
        <label>
          Status
          <select
            value={risk.status}
            disabled={busy}
            onChange={(event) => mutate({ action: "update-risk", riskId: risk.id, status: event.target.value as RiskStatus })}
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
    </article>
  );
}
