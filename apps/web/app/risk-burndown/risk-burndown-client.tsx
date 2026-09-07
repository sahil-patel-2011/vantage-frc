"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { EmptyState, FormGrid, FormRow, PageHeader, Panel } from "../../components/ui";
import { riskCategoryLabel, riskStatusLabel } from "../../lib/risk-burndown";
import {
  RISK_CATEGORIES,
  RISK_STATUSES,
  type RiskBurndownView,
} from "../../lib/risk-burndown/compute-risk-burndown";
import {
  RISK_BURNDOWN_RELATED_INCLUDE,
  classifyRiskBurndownShell,
  formatRiskBurndownMetric,
  riskBurndownNextActions,
  riskBurndownRelatedLinks,
  riskBurndownShellCopy,
  shouldShowRiskBurndownSummaryTiles,
  type RiskBurndownNextAction,
  type RiskBurndownShellKind,
} from "../../lib/risk-burndown/risk-burndown-related";
import type { RiskCategory, RiskSeverityBand, RiskStatus } from "../../lib/risk-burndown/types";
import { hubHref, hubWorkbenchHref } from "../../lib/nav/hubs";
import { withOrgHref } from "../../lib/nav/product-nav";
import "./risk-burndown.css";

function severityTone(band: RiskSeverityBand): string {
  if (band === "critical") return "danger";
  if (band === "high") return "setup";
  if (band === "medium") return "setup";
  return "good";
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

type LiveView = Extract<RiskBurndownView, { status: "live" }>;

function RiskBurndownRelatedStrip({ orgId }: { orgId?: string | null }) {
  const links = riskBurndownRelatedLinks(orgId, {
    include: [...RISK_BURNDOWN_RELATED_INCLUDE],
  });
  if (!links.length) return null;
  return (
    <nav className="product-hub-related risk-burndown-related" aria-label="Related risk tools">
      {links.map((link) => (
        <a key={link.id} className="app-button secondary" href={link.href}>
          {link.label}
        </a>
      ))}
    </nav>
  );
}

function RiskBurndownNextActionsPanel({ actions }: { actions: RiskBurndownNextAction[] }) {
  if (!actions.length) return null;
  return (
    <section
      className="app-card soft-panel edc-next-actions risk-burndown-next-actions"
      aria-label="Next actions"
    >
      <header>
        <h2>Next actions</h2>
        <p className="app-muted">Risks and FMEA — never DEMO burndown metrics.</p>
      </header>
      <ol>
        {actions.map((action) => (
          <li key={action.id} className={action.primary ? "primary" : undefined}>
            <div>
              <strong>{action.label}</strong>
              <span>{action.detail}</span>
            </div>
            <a className="app-button secondary" href={action.href} aria-label={`Open ${action.label}`}>Open</a>
          </li>
        ))}
      </ol>
    </section>
  );
}

function RiskBurndownShell({
  description,
  orgId,
  shell,
  error,
  onRetry,
  children,
}: {
  description: string;
  orgId?: string | null;
  shell: RiskBurndownShellKind;
  error?: string;
  onRetry?: () => void;
  children?: ReactNode;
}) {
  const actions = riskBurndownNextActions({ orgId, shell });
  const copy = riskBurndownShellCopy(shell);
  const teamHref = hubWorkbenchHref("team", "risk-burndown", orgId);
  const risksHref = withOrgHref("/risks", orgId);
  const fmeaHref = hubHref("/team", "fmea", orgId);

  return (
    <main className="module-page risk-burndown-page soft-gate">
      <PageHeader
        breadcrumbs={
          <>
            <a href={teamHref}>Team</a>
            {" / Risk-Register Burndown"}
          </>
        }
        title="Risk-Register Burndown"
        description={description}
      >
        <RiskBurndownRelatedStrip orgId={orgId} />
      </PageHeader>
      {children}
      <EmptyState
        soft
        badge={
          shell === "setup"
            ? "Setup required"
            : shell === "error"
              ? "Unavailable"
              : shell === "empty"
                ? "No risks yet"
                : copy.badge
        }
        badgeTone="setup"
        title={copy.title}
        description={error ?? copy.description}
        aria-busy={shell === "loading"}
      >
        {shell === "error" && onRetry ? (
          <button type="button" className="app-button secondary" onClick={onRetry}>
            Retry
          </button>
        ) : null}
        {shell === "setup" ? (
          <a className="app-button" href={orgId ? withOrgHref("/workspace", orgId) : "/workspace"}>
            Open Workspace
          </a>
        ) : null}
        {shell === "empty" ? (
          <>
            <a className="app-button" href={risksHref}>
              Open Risks
            </a>
            <a className="app-button secondary" href={fmeaHref}>
              Open FMEA
            </a>
          </>
        ) : null}
      </EmptyState>
      <RiskBurndownNextActionsPanel actions={actions} />
    </main>
  );
}

export default function RiskBurndownClient() {
  const [view, setView] = useState<RiskBurndownView | null>(null);
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
    void fetch(`/api/risk-burndown${query.toString() ? `?${query.toString()}` : ""}`)
      .then(async (response) => {
        const data = (await response.json()) as RiskBurndownView | { error?: string };
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
  const riskCount = view?.status === "live" ? view.summary.totalRisks : 0;
  const openRiskCount = view?.status === "live" ? view.summary.openRisks : 0;
  const highSeverityOpenCount = view?.status === "live" ? view.summary.highSeverityOpenCount : 0;

  const shell = classifyRiskBurndownShell({
    loading: view == null && !fetchFailed,
    fetchFailed,
    status: view?.status ?? null,
    orgId: view?.status === "live" ? view.orgId : view?.status === "setup_required" ? view.orgId : null,
    riskCount,
  });
  const shellCopy = riskBurndownShellCopy(shell);
  const nextActions = riskBurndownNextActions({
    orgId,
    shell,
    riskCount,
    openRiskCount,
    highSeverityOpenCount,
  });
  const relatedLinks = riskBurndownRelatedLinks(orgId, {
    include: [...RISK_BURNDOWN_RELATED_INCLUDE],
  });
  const teamHref = hubWorkbenchHref("team", "risk-burndown", orgId);
  const risksHref = withOrgHref("/risks", orgId);
  const fmeaHref = hubHref("/team", "fmea", orgId);

  const mutate = useCallback(
    async (payload: Record<string, unknown>) => {
      if (!orgId || busy) return;
      setBusy(true);
      setError("");
      try {
        const response = await fetch("/api/risk-burndown", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, seasonYear: season ?? undefined, ...payload }),
        });
        const data = (await response.json()) as RiskBurndownView | { error?: string };
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
    return <RiskBurndownShell description={shellCopy.description} orgId={null} shell="loading" />;
  }

  if (shell === "error") {
    return (
      <RiskBurndownShell
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
      <RiskBurndownShell
        description={view?.status === "setup_required" ? view.message : shellCopy.description}
        orgId={orgId}
        shell="setup"
      >
        {view?.status === "setup_required" && view.steps.length > 0 ? (
          <ol className="strategy-setup-steps">
            {view.steps.map((step) => (
              <li key={step.id}>
                <div>
                  <strong>{step.label}</strong>
                  <span>{step.detail}</span>
                </div>
                <a href={step.href} aria-label={`Open ${step.label}`}>Open</a>
              </li>
            ))}
          </ol>
        ) : null}
      </RiskBurndownShell>
    );
  }

  if (view?.status !== "live") {
    return <RiskBurndownShell description={shellCopy.description} orgId={orgId} shell="setup" />;
  }

  return (
    <main className="module-page risk-burndown-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={teamHref}>Team</a>
            {" / Risk-Register Burndown"}
          </>
        }
        title="Risk-Register Burndown"
        description="Track season risks — technical, schedule, budget, personnel, logistics, safety — and watch the register burn down as mitigations close them out. Cross-check Risks and FMEA — never DEMO burndown metrics."
      >
        <div className="risk-burndown-header-actions">
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
          {relatedLinks.map((link) => (
            <a key={link.id} className="app-button secondary" href={link.href}>
              {link.label}
            </a>
          ))}
        </div>
      </PageHeader>

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      <RiskBurndownNextActionsPanel actions={nextActions} />

      {shouldShowRiskBurndownSummaryTiles(riskCount) ? <SummaryTiles view={view} /> : null}

      {shell === "empty" ? (
        <EmptyState
          soft
          badge="No risks yet"
          badgeTone="setup"
          title={shellCopy.title}
          description={shellCopy.description}
        >
          <a className="app-button" href={risksHref}>
            Open Risks
          </a>
          <a className="app-button secondary" href={fmeaHref}>
            Open FMEA
          </a>
        </EmptyState>
      ) : null}

      <div className="risk-burndown-layout">
        {shouldShowRiskBurndownSummaryTiles(riskCount) ? <BurndownSeries view={view} /> : null}
        <LogRiskForm busy={busy} mutate={mutate} />
        {view.summary.totalRisks > 0 ? <Breakdowns view={view} /> : null}
        <RiskRegister view={view} busy={busy} mutate={mutate} />
        <Panel className="risk-burndown-tip" aria-label="Risk burndown tip">
          <span className="eyebrow">Risk path</span>
          <p className="app-muted" style={{ marginTop: 8 }}>
            Keep season L×I scores in <a href={risksHref}>Risks</a> and failure modes in{" "}
            <a href={fmeaHref}>FMEA</a> aligned with closures here — never invent DEMO open counts,
            severity bands, or burndown signal.
          </p>
        </Panel>
      </div>
    </main>
  );
}

function SummaryTiles({ view }: { view: LiveView }) {
  const { summary } = view;
  const tiles = [
    { label: "Total risks", value: formatRiskBurndownMetric(summary.totalRisks, true) },
    { label: "Open", value: formatRiskBurndownMetric(summary.openRisks, true) },
    { label: "Mitigating", value: formatRiskBurndownMetric(summary.mitigatingRisks, true) },
    {
      label: "Closed",
      value: formatRiskBurndownMetric(summary.closedRisks + summary.acceptedRisks, true),
    },
    {
      label: "High-severity open",
      value: formatRiskBurndownMetric(summary.highSeverityOpenCount, true),
    },
    { label: "Burndown signal", value: pct(summary.burndownSignal) },
  ];
  return (
    <section className="risk-burndown-stats" aria-label="Real risk burndown counts">
      {tiles.map((tile) => (
        <div key={tile.label}>
          <strong>{tile.value}</strong>
          <span className="app-muted" style={{ display: "block" }}>
            {tile.label}
          </span>
        </div>
      ))}
    </section>
  );
}

function BurndownSeries({ view }: { view: LiveView }) {
  if (view.series.length === 0) return null;
  const maxOpen = Math.max(1, ...view.series.map((point) => point.openCount));
  const recent = view.series.slice(-30);
  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>Open-risk burndown</h2>
      <div className="risk-burndown-series" aria-hidden="true">
        {recent.map((point) => (
          <span
            key={point.date}
            className="risk-burndown-series-bar"
            title={`${point.date}: ${point.openCount} open`}
            style={{ height: `${Math.max(4, (point.openCount / maxOpen) * 100)}%` }}
          />
        ))}
      </div>
      <small className="app-muted">
        {recent[0]?.date} → {recent[recent.length - 1]?.date} · {recent[recent.length - 1]?.openCount}{" "}
        open today
      </small>
    </Panel>
  );
}

function Breakdowns({ view }: { view: LiveView }) {
  const { summary } = view;
  return (
    <section className="app-card soft-panel risk-burndown-breakdowns">
      <div>
        <h2 style={{ marginTop: 0 }}>By category</h2>
        <ul className="risk-burndown-list">
          {summary.byCategory.map((row) => (
            <li key={row.category} className="risk-burndown-row">
              <span>{riskCategoryLabel(row.category)}</span>
              <small className="app-muted">
                {row.count} · avg severity {row.avgSeverity}
              </small>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <h2 style={{ marginTop: 0 }}>By status</h2>
        <ul className="risk-burndown-list">
          {summary.byStatus.map((row) => (
            <li key={row.status} className="risk-burndown-row">
              <span>{riskStatusLabel(row.status)}</span>
              <small className="app-muted">{row.count}</small>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <h2 style={{ marginTop: 0 }}>By severity band</h2>
        <ul className="risk-burndown-list">
          {summary.bySeverityBand.map((row) => (
            <li key={row.band} className="risk-burndown-row">
              <span className={`app-badge ${severityTone(row.band)}`}>{row.band.toUpperCase()}</span>
              <small className="app-muted">{row.count}</small>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function RiskRegister({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  if (view.summary.totalRisks === 0) {
    return null;
  }
  return (
    <Panel id="risk-burndown-register">
      <h2 style={{ marginTop: 0 }}>Risk register</h2>
      <ul className="risk-burndown-list">
        {view.risks.map((item) => (
          <li key={item.id} className="risk-burndown-row">
            <div>
              <span className={`app-badge ${severityTone(item.severityBand)}`}>
                {item.severityBand.toUpperCase()}
              </span>{" "}
              <strong>{item.title}</strong>
              <small className="app-muted" style={{ display: "block" }}>
                {item.identifiedOn} · {riskCategoryLabel(item.category)} · {riskStatusLabel(item.status)}
                {item.ownerName ? ` · ${item.ownerName}` : ""} · L{item.likelihood} × I{item.impact} ={" "}
                {item.severity}
              </small>
              {item.mitigationPlan ? (
                <small className="app-muted" style={{ display: "block" }}>
                  Mitigation: {item.mitigationPlan}
                </small>
              ) : null}
            </div>
            <div className="risk-burndown-row-actions">
              <select
                value={item.status}
                disabled={busy}
                onChange={(event) =>
                  mutate({
                    action: "update-status",
                    riskId: item.id,
                    status: event.target.value as RiskStatus,
                  })
                }
              >
                {RISK_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {riskStatusLabel(status)}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() => {
                  if (window.confirm(`Delete "${item.title}"?`)) {
                    mutate({ action: "delete-risk", riskId: item.id });
                  }
                }}
              >
                Delete
              </button>
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function LogRiskForm({
  busy,
  mutate,
}: {
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const empty = useMemo(
    () => ({
      title: "",
      description: "",
      identifiedOn: "",
      targetCloseDate: "",
      category: "technical" as RiskCategory,
      status: "open" as RiskStatus,
      likelihood: "3",
      impact: "3",
      ownerName: "",
      mitigationPlan: "",
    }),
    [],
  );
  const [form, setForm] = useState(empty);
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }));

  return (
    <Panel
      id="risk-burndown-log-risk"
      as="form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!form.title.trim() || !form.identifiedOn) return;
        mutate({
          action: "log-risk",
          title: form.title,
          description: form.description || undefined,
          identifiedOn: form.identifiedOn,
          targetCloseDate: form.targetCloseDate || undefined,
          category: form.category,
          status: form.status,
          likelihood: Number(form.likelihood) || 3,
          impact: Number(form.impact) || 3,
          ownerName: form.ownerName || undefined,
          mitigationPlan: form.mitigationPlan || undefined,
        });
        setForm(empty);
      }}
      style={{ display: "grid", gap: 10 }}
    >
      <h2 style={{ margin: 0 }}>Log risk</h2>
      <p className="app-muted" style={{ margin: 0 }}>
        Likelihood × impact come from real season judgment — never DEMO severity scores.
      </p>
      <FormGrid min={160}>
        <FormRow label="Title">
          <input value={form.title} onChange={set("title")} placeholder="Chassis vendor delay" required />
        </FormRow>
        <FormRow label="Identified on">
          <input type="date" value={form.identifiedOn} onChange={set("identifiedOn")} required />
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
        <FormRow label="Status">
          <select value={form.status} onChange={set("status")}>
            {RISK_STATUSES.map((status) => (
              <option key={status} value={status}>
                {riskStatusLabel(status)}
              </option>
            ))}
          </select>
        </FormRow>
        <FormRow label="Likelihood (1-5)">
          <input type="number" min={1} max={5} value={form.likelihood} onChange={set("likelihood")} />
        </FormRow>
        <FormRow label="Impact (1-5)">
          <input type="number" min={1} max={5} value={form.impact} onChange={set("impact")} />
        </FormRow>
        <FormRow label="Owner (optional)">
          <input value={form.ownerName} onChange={set("ownerName")} />
        </FormRow>
        <FormRow label="Target close date (optional)">
          <input type="date" value={form.targetCloseDate} onChange={set("targetCloseDate")} />
        </FormRow>
      </FormGrid>
      <FormRow label="Description (optional)">
        <textarea value={form.description} onChange={set("description")} rows={2} />
      </FormRow>
      <FormRow label="Mitigation plan (optional)">
        <textarea value={form.mitigationPlan} onChange={set("mitigationPlan")} rows={2} />
      </FormRow>
      <div>
        <button type="submit" className="app-button" disabled={busy || !form.title.trim() || !form.identifiedOn}>
          Log risk
        </button>
      </div>
    </Panel>
  );
}
