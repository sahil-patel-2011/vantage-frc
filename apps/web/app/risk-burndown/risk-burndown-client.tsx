"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState, FormGrid, FormRow, PageHeader, Panel } from "../../components/ui";
import { riskCategoryLabel, riskStatusLabel } from "../../lib/risk-burndown";
import {
  RISK_CATEGORIES,
  RISK_STATUSES,
  type RiskBurndownView,
} from "../../lib/risk-burndown/compute-risk-burndown";
import type { RiskCategory, RiskSeverityBand, RiskStatus } from "../../lib/risk-burndown/types";

function severityTone(band: RiskSeverityBand): string {
  if (band === "critical") return "danger";
  if (band === "high") return "demo";
  if (band === "medium") return "setup";
  return "good";
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

type LiveView = Extract<RiskBurndownView, { status: "live" }>;

export default function RiskBurndownClient() {
  const [view, setView] = useState<RiskBurndownView | null>(null);
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

  return (
    <main className="module-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={orgId ? `/team?orgId=${encodeURIComponent(orgId)}` : "/team"}>Team</a>
            {" / Risk-Register Burndown"}
          </>
        }
        title="Risk-Register Burndown"
        description="Track season risks — technical, schedule, budget, personnel, logistics, safety — and watch the register burn down as mitigations close them out."
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
          <BurndownSeries view={view} />
          <LogRiskForm busy={busy} mutate={mutate} />
          {view.summary.totalRisks > 0 ? <Breakdowns view={view} /> : null}
          <RiskRegister view={view} busy={busy} mutate={mutate} />
        </div>
      )}
    </main>
  );
}

function SummaryTiles({ view }: { view: LiveView }) {
  const { summary } = view;
  const tiles = [
    { label: "Total risks", value: String(summary.totalRisks) },
    { label: "Open", value: String(summary.openRisks) },
    { label: "Mitigating", value: String(summary.mitigatingRisks) },
    { label: "Closed", value: String(summary.closedRisks + summary.acceptedRisks) },
    { label: "High-severity open", value: String(summary.highSeverityOpenCount) },
    { label: "Burndown signal", value: pct(summary.burndownSignal) },
  ];
  return (
    <Panel>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 12 }}>
        {tiles.map((tile) => (
          <div key={tile.label}>
            <strong style={{ fontSize: "1.6rem", display: "block" }}>{tile.value}</strong>
            <span className="app-muted">{tile.label}</span>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function BurndownSeries({ view }: { view: LiveView }) {
  if (view.series.length === 0) return null;
  const maxOpen = Math.max(1, ...view.series.map((point) => point.openCount));
  const recent = view.series.slice(-30);
  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>Open-risk burndown</h2>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 80 }} aria-hidden="true">
        {recent.map((point) => (
          <span
            key={point.date}
            title={`${point.date}: ${point.openCount} open`}
            style={{
              display: "inline-block",
              flex: "1 0 auto",
              minWidth: 3,
              height: `${Math.max(4, (point.openCount / maxOpen) * 100)}%`,
              background: "var(--app-accent, #6366f1)",
              borderRadius: 2,
            }}
          />
        ))}
      </div>
      <small className="app-muted">
        {recent[0]?.date} → {recent[recent.length - 1]?.date} · {recent[recent.length - 1]?.openCount} open today
      </small>
    </Panel>
  );
}

function Breakdowns({ view }: { view: LiveView }) {
  const { summary } = view;
  return (
    <section
      className="app-card soft-panel"
      style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 20 }}
    >
      <div>
        <h2 style={{ marginTop: 0 }}>By category</h2>
        <ul className="factor-table" style={{ listStyle: "none", padding: 0, display: "grid", gap: 6 }}>
          {summary.byCategory.map((row) => (
            <li key={row.category} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
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
        <ul className="factor-table" style={{ listStyle: "none", padding: 0, display: "grid", gap: 6 }}>
          {summary.byStatus.map((row) => (
            <li key={row.status} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <span>{riskStatusLabel(row.status)}</span>
              <small className="app-muted">{row.count}</small>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <h2 style={{ marginTop: 0 }}>By severity band</h2>
        <ul className="factor-table" style={{ listStyle: "none", padding: 0, display: "grid", gap: 6 }}>
          {summary.bySeverityBand.map((row) => (
            <li key={row.band} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
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
    return (
      <EmptyState
        badge="No risks logged yet"
        badgeTone="setup"
        title="Log your first season risk"
        description="Technical, schedule, budget, personnel, logistics, and safety risks all belong in the register."
      />
    );
  }
  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>Risk register</h2>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 10 }}>
        {view.risks.map((item) => (
          <li key={item.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
            <div>
              <span className={`app-badge ${severityTone(item.severityBand)}`}>{item.severityBand.toUpperCase()}</span>{" "}
              <strong>{item.title}</strong>
              <small className="app-muted" style={{ display: "block" }}>
                {item.identifiedOn} · {riskCategoryLabel(item.category)} · {riskStatusLabel(item.status)}
                {item.ownerName ? ` · ${item.ownerName}` : ""} · L{item.likelihood} × I{item.impact} = {item.severity}
              </small>
              {item.mitigationPlan ? (
                <small className="app-muted" style={{ display: "block" }}>
                  Mitigation: {item.mitigationPlan}
                </small>
              ) : null}
            </div>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <select
                value={item.status}
                disabled={busy}
                onChange={(event) =>
                  mutate({ action: "update-status", riskId: item.id, status: event.target.value as RiskStatus })
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
