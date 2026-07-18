"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState, FormGrid, FormRow, PageHeader, Panel } from "../../components/ui";
import { costCategoryLabel, subscriptionCadenceLabel, usd } from "../../lib/costs";
import {
  COST_CATEGORIES,
  COST_STATUSES,
  SUBSCRIPTION_CADENCES,
  type CostsView,
} from "../../lib/costs/compute-costs";
import type {
  BudgetStatus,
  CostCategory,
  CostStatus,
  SeasonCost,
  SubscriptionCadence,
  SubscriptionWithAnnual,
} from "../../lib/costs/types";

type LiveView = Extract<CostsView, { status: "live" }>;
type Mutate = (payload: Record<string, unknown>) => void;

const SOURCE_COLOR: Record<string, string> = {
  season: "#1f4fd6",
  subscriptions: "#7a4fd6",
  api: "#1f7a3d",
};

function statusTone(status: BudgetStatus): string {
  if (status === "over") return "#c02626";
  if (status === "watch") return "#b26a00";
  if (status === "healthy") return "#1f7a3d";
  return "inherit";
}

export default function CostsClient() {
  const [view, setView] = useState<CostsView | null>(null);
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
    void fetch(`/api/costs${query.toString() ? `?${query.toString()}` : ""}`)
      .then(async (response) => {
        const data = (await response.json()) as CostsView | { error?: string };
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
      void fetch("/api/costs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId, seasonYear: season ?? undefined, ...payload }),
      })
        .then(async (response) => {
          const data = (await response.json()) as CostsView | { error?: string };
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
        breadcrumbs={
          <>
            <a href={orgId ? `/business?orgId=${encodeURIComponent(orgId)}` : "/business"}>Business</a>
            {" / Season Costs"}
          </>
        }
        title="Season Costs"
        description="Real-world spend, subscriptions, and live AI/API usage against one season budget — separate from Business purchase approvals."
      >
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
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
          {orgId ? (
            <>
              <a className="app-button secondary" href={`/business?orgId=${encodeURIComponent(orgId)}&tab=budget`}>
                Business budget
              </a>
              <a className="app-button secondary" href={`/impact?orgId=${encodeURIComponent(orgId)}`}>
                Impact
              </a>
            </>
          ) : null}
        </div>
      </PageHeader>

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      {fetchFailed ? (
        <EmptyState
          title="Could not load season costs"
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
          <AllInPanel view={view} />
          <BudgetPanel view={view} busy={busy} mutate={mutate} />
          {view.insight ? <AssistantPanel view={view} /> : null}
          <SubscriptionsSection view={view} busy={busy} mutate={mutate} />
          <AddCostForm busy={busy} mutate={mutate} />
          {view.summary.byCategory.length > 0 ? <CategoryBreakdown view={view} /> : null}
          <CostLog view={view} busy={busy} mutate={mutate} />
        </div>
      )}
    </main>
  );
}

function AllInPanel({ view }: { view: LiveView }) {
  const all = view.allCosts;
  const max = Math.max(all.grandTotal, 1);
  return (
    <Panel aria-label="Total season cost" style={{ display: "grid", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <div>
          <span className="app-muted">All-in season cost ({view.seasonYear})</span>
          <strong style={{ fontSize: "2.2rem", display: "block" }}>{usd(all.grandTotal)}</strong>
        </div>
        <small className="app-muted" style={{ maxWidth: 280 }}>
          Everything: purchases &amp; fees + annualized subscriptions + the app&apos;s live AI/API usage.
        </small>
      </div>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 8 }}>
        {all.breakdown.map((row) => (
          <li key={row.key} style={{ display: "grid", gridTemplateColumns: "180px 1fr auto", gap: 8, alignItems: "center" }}>
            <span>
              <span
                aria-hidden="true"
                style={{ display: "inline-block", width: 10, height: 10, borderRadius: 2, background: SOURCE_COLOR[row.key], marginRight: 6 }}
              />
              {row.label}
            </span>
            <span className="mini-probability" aria-hidden="true">
              <i style={{ width: `${Math.max(1, (row.amount / max) * 100)}%`, background: SOURCE_COLOR[row.key] }} />
            </span>
            <small className="app-muted" style={{ textAlign: "right" }}>
              {usd(row.amount)} · {Math.round(row.pct * 100)}%
            </small>
          </li>
        ))}
      </ul>
      <small className="app-muted">
        App AI/API usage ({usd(view.apiUsageUsd)}) is read live from your usage ledger for this season — separate from the
        real-world budget below.
      </small>
    </Panel>
  );
}

function BudgetPanel({ view, busy, mutate }: { view: LiveView; busy: boolean; mutate: Mutate }) {
  const { budget, summary } = view;
  const [budgetInput, setBudgetInput] = useState("");
  const [aiAssist, setAiAssist] = useState(false);

  useEffect(() => {
    setBudgetInput(budget.totalBudgetUsd == null ? "" : String(budget.totalBudgetUsd));
    setAiAssist(budget.aiAssistEnabled);
  }, [budget.totalBudgetUsd, budget.aiAssistEnabled, view.computedAt]);

  const pct = summary.pctUsed == null ? null : Math.min(1.2, summary.pctUsed);
  const barColor = summary.overBudget ? "#c02626" : (pct ?? 0) >= 0.85 ? "#b26a00" : "#1f7a3d";

  const saveBudget = (nextAi?: boolean) =>
    mutate({
      action: "set-budget",
      totalBudgetUsd: budgetInput === "" ? undefined : budgetInput,
      aiAssistEnabled: nextAi ?? aiAssist,
    });

  return (
    <Panel style={{ display: "grid", gap: 12 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 12 }}>
        <div>
          <strong style={{ fontSize: "1.6rem", display: "block" }}>
            {budget.totalBudgetUsd == null ? "—" : usd(budget.totalBudgetUsd)}
          </strong>
          <span className="app-muted">Season budget</span>
        </div>
        <div>
          <strong style={{ fontSize: "1.6rem", display: "block" }}>{usd(summary.totalCommitted)}</strong>
          <span className="app-muted">Committed (real-world)</span>
        </div>
        <div>
          <strong style={{ fontSize: "1.6rem", display: "block", color: summary.overBudget ? "#c02626" : "inherit" }}>
            {summary.remaining == null ? "—" : usd(summary.remaining)}
          </strong>
          <span className="app-muted">Remaining</span>
        </div>
        <div>
          <strong style={{ fontSize: "1.6rem", display: "block" }}>{usd(summary.feesTotal)}</strong>
          <span className="app-muted">Fixed fees</span>
        </div>
      </div>

      {pct != null ? (
        <div>
          <div className="mini-probability" aria-hidden="true">
            <i style={{ width: `${Math.max(2, (pct / 1.2) * 100)}%`, background: barColor }} />
          </div>
          <small className="app-muted">
            {Math.round((summary.pctUsed ?? 0) * 100)}% of budget committed
            {summary.overBudget ? " · over budget" : ""}
          </small>
        </div>
      ) : (
        <p className="app-muted" style={{ margin: 0 }}>
          Set a season budget to track spend against it.
        </p>
      )}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          saveBudget();
        }}
        style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap", borderTop: "1px solid rgba(128,128,128,0.2)", paddingTop: 12 }}
      >
        <label style={{ display: "grid", gap: 4 }}>
          <span className="app-muted">Season budget ($)</span>
          <input
            type="number"
            min={0}
            step="1"
            value={budgetInput}
            onChange={(event) => setBudgetInput(event.target.value)}
            placeholder="e.g. 25000"
          />
        </label>
        <button type="submit" className="app-button" disabled={busy}>
          Save budget
        </button>
        <label
          style={{ display: "flex", gap: 8, alignItems: "center", marginLeft: "auto", maxWidth: 340 }}
          title="Automated, rule-based analysis of your budget. Your data stays within your team; no external AI is called."
        >
          <input
            type="checkbox"
            checked={aiAssist}
            disabled={busy}
            onChange={(event) => {
              setAiAssist(event.target.checked);
              saveBudget(event.target.checked);
            }}
          />
          <span>
            <strong>AI finance assistant</strong>
            <small className="app-muted" style={{ display: "block" }}>
              Opt-in. Turns your budget into plain-language guidance to stay on track.
            </small>
          </span>
        </label>
      </form>
    </Panel>
  );
}

function AssistantPanel({ view }: { view: LiveView }) {
  const insight = view.insight;
  if (!insight) return null;
  return (
    <section
      className="app-card soft-panel"
      aria-label="Finance assistant"
      style={{ borderLeft: `3px solid ${statusTone(insight.status)}` }}
    >
      <header style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span className="app-badge" style={{ background: statusTone(insight.status), color: "#fff" }}>
          {insight.status === "over"
            ? "Over budget"
            : insight.status === "watch"
              ? "Watch"
              : insight.status === "healthy"
                ? "On track"
                : "Set up"}
        </span>
        <h2 style={{ margin: 0, fontSize: "1.1rem" }}>Finance assistant</h2>
      </header>
      <p style={{ margin: "8px 0", fontWeight: 600 }}>{insight.headline}</p>
      <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 6 }}>
        {insight.recommendations.map((rec) => (
          <li key={rec}>{rec}</li>
        ))}
      </ul>
      <small className="app-muted" style={{ display: "block", marginTop: 8 }}>
        Automated analysis of your own budget data — rule-based, kept within your team.
      </small>
    </section>
  );
}

function SubscriptionsSection({ view, busy, mutate }: { view: LiveView; busy: boolean; mutate: Mutate }) {
  const subs = view.subscriptions;
  return (
    <section className="app-card soft-panel" style={{ display: "grid", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0 }}>Subscriptions</h2>
        <span className="app-muted">
          {subs.activeCount} active · <strong>{usd(subs.totalAnnual)}</strong>/yr
        </span>
      </div>

      {subs.items.length > 0 ? (
        <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 8 }}>
          {subs.items.map((sub: SubscriptionWithAnnual) => (
            <li
              key={sub.id}
              style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", opacity: sub.active ? 1 : 0.55 }}
            >
              <div>
                <strong>{sub.name}</strong>
                {sub.provider ? <small className="app-muted"> · {sub.provider}</small> : null}
                <small className="app-muted" style={{ display: "block" }}>
                  {usd(sub.amountUsd)} {subscriptionCadenceLabel(sub.cadence).toLowerCase()} · {usd(sub.annualUsd)}/yr
                </small>
              </div>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <button
                  type="button"
                  className={`app-badge ${sub.active ? "good" : "demo"}`}
                  disabled={busy}
                  title="Toggle active"
                  onClick={() => mutate({ action: "update-subscription", subscriptionId: sub.id, active: !sub.active })}
                  style={{ cursor: "pointer", border: "none" }}
                >
                  {sub.active ? "Active" : "Inactive"}
                </button>
                <button
                  type="button"
                  className="text-button"
                  disabled={busy}
                  onClick={() => {
                    if (window.confirm(`Delete "${sub.name}"?`)) mutate({ action: "delete-subscription", subscriptionId: sub.id });
                  }}
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="app-muted" style={{ margin: 0 }}>
          Add recurring costs — your Vantage plan, CAD licenses, hosting, software — to see the true all-in season total.
        </p>
      )}

      <AddSubscriptionForm busy={busy} mutate={mutate} />
    </section>
  );
}

function AddSubscriptionForm({ busy, mutate }: { busy: boolean; mutate: Mutate }) {
  const empty = useMemo(
    () => ({ name: "", provider: "", amountUsd: "", cadence: "monthly" as SubscriptionCadence }),
    [],
  );
  const [form, setForm] = useState(empty);
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }));

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (!form.name.trim()) return;
        mutate({
          action: "add-subscription",
          name: form.name,
          provider: form.provider || undefined,
          amountUsd: form.amountUsd || 0,
          cadence: form.cadence,
          active: true,
        });
        setForm(empty);
      }}
      style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap", borderTop: "1px solid rgba(128,128,128,0.2)", paddingTop: 12 }}
    >
      <label style={{ display: "grid", gap: 4, flex: "2 1 160px" }}>
        <span className="app-muted">Subscription</span>
        <input value={form.name} onChange={set("name")} placeholder="Onshape, Fusion, hosting…" required />
      </label>
      <label style={{ display: "grid", gap: 4 }}>
        <span className="app-muted">Provider (optional)</span>
        <input value={form.provider} onChange={set("provider")} />
      </label>
      <label style={{ display: "grid", gap: 4, width: 110 }}>
        <span className="app-muted">Amount ($)</span>
        <input type="number" min={0} step="0.01" value={form.amountUsd} onChange={set("amountUsd")} required />
      </label>
      <label style={{ display: "grid", gap: 4 }}>
        <span className="app-muted">Cadence</span>
        <select value={form.cadence} onChange={set("cadence")}>
          {SUBSCRIPTION_CADENCES.map((cadence) => (
            <option key={cadence} value={cadence}>
              {subscriptionCadenceLabel(cadence)}
            </option>
          ))}
        </select>
      </label>
      <button type="submit" className="app-button secondary" disabled={busy || !form.name.trim()}>
        Add subscription
      </button>
    </form>
  );
}

function AddCostForm({ busy, mutate }: { busy: boolean; mutate: Mutate }) {
  const empty = useMemo(
    () => ({
      label: "",
      category: "parts" as CostCategory,
      amountUsd: "",
      vendor: "",
      incurredOn: "",
      status: "paid" as CostStatus,
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
        if (!form.label.trim() || !form.incurredOn) return;
        mutate({
          action: "add-cost",
          label: form.label,
          category: form.category,
          amountUsd: form.amountUsd || 0,
          vendor: form.vendor || undefined,
          incurredOn: form.incurredOn,
          status: form.status,
        });
        setForm(empty);
      }}
      style={{ display: "grid", gap: 10 }}
    >
      <h2 style={{ margin: 0 }}>Add cost</h2>
      <FormGrid min={140}>
        <FormRow label="What was it?" wide>
          <input value={form.label} onChange={set("label")} placeholder="Regional registration, swerve modules…" required />
        </FormRow>
        <FormRow label="Category">
          <select value={form.category} onChange={set("category")}>
            {COST_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {costCategoryLabel(category)}
              </option>
            ))}
          </select>
        </FormRow>
        <FormRow label="Amount ($)">
          <input type="number" min={0} step="0.01" value={form.amountUsd} onChange={set("amountUsd")} required />
        </FormRow>
        <FormRow label="Vendor (optional)">
          <input value={form.vendor} onChange={set("vendor")} />
        </FormRow>
        <FormRow label="Date">
          <input type="date" value={form.incurredOn} onChange={set("incurredOn")} required />
        </FormRow>
        <FormRow label="Status">
          <select value={form.status} onChange={set("status")}>
            {COST_STATUSES.map((status) => (
              <option key={status} value={status}>
                {status === "paid" ? "Paid" : "Planned"}
              </option>
            ))}
          </select>
        </FormRow>
      </FormGrid>
      <div>
        <button type="submit" className="app-button" disabled={busy || !form.label.trim() || !form.incurredOn}>
          Add cost
        </button>
      </div>
    </Panel>
  );
}

function CategoryBreakdown({ view }: { view: LiveView }) {
  const { byCategory } = view.summary;
  const max = Math.max(...byCategory.map((c) => c.committed), 1);
  return (
    <section className="app-card soft-panel">
      <h2 style={{ marginTop: 0 }}>By category</h2>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 8 }}>
        {byCategory.map((row) => (
          <li key={row.category} style={{ display: "grid", gridTemplateColumns: "160px 1fr auto", gap: 8, alignItems: "center" }}>
            <span>{costCategoryLabel(row.category)}</span>
            <span className="mini-probability" aria-hidden="true">
              <i style={{ width: `${Math.max(2, (row.committed / max) * 100)}%` }} />
            </span>
            <small className="app-muted" style={{ textAlign: "right" }}>
              {usd(row.committed)}
              {row.planned > 0 ? ` (${usd(row.planned)} planned)` : ""}
            </small>
          </li>
        ))}
      </ul>
    </section>
  );
}

function CostLog({ view, busy, mutate }: { view: LiveView; busy: boolean; mutate: Mutate }) {
  if (view.costs.length === 0) {
    return (
      <EmptyState
        badge="No costs yet"
        badgeTone="setup"
        title="Log your first cost"
        description="Start with your season registration and event fees, then add purchases as you go."
      />
    );
  }
  return (
    <Panel style={{ overflowX: "auto" }}>
      <h2 style={{ marginTop: 0 }}>Cost log</h2>
      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 640 }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "1px solid rgba(128,128,128,0.3)" }}>
            <th style={{ padding: "6px 8px" }}>Date</th>
            <th style={{ padding: "6px 8px" }}>Item</th>
            <th style={{ padding: "6px 8px" }}>Category</th>
            <th style={{ padding: "6px 8px", textAlign: "right" }}>Amount</th>
            <th style={{ padding: "6px 8px" }}>Status</th>
            <th style={{ padding: "6px 8px" }} aria-label="actions" />
          </tr>
        </thead>
        <tbody>
          {view.costs.map((cost: SeasonCost) => (
            <tr key={cost.id} style={{ borderBottom: "1px solid rgba(128,128,128,0.15)" }}>
              <td style={{ padding: "6px 8px", whiteSpace: "nowrap" }}>{cost.incurredOn}</td>
              <td style={{ padding: "6px 8px" }}>
                <strong>{cost.label}</strong>
                {cost.vendor ? <small className="app-muted" style={{ display: "block" }}>{cost.vendor}</small> : null}
              </td>
              <td style={{ padding: "6px 8px" }}>{costCategoryLabel(cost.category)}</td>
              <td style={{ padding: "6px 8px", textAlign: "right" }}>{usd(cost.amountUsd)}</td>
              <td style={{ padding: "6px 8px" }}>
                <button
                  type="button"
                  className={`app-badge ${cost.status === "paid" ? "good" : "setup"}`}
                  disabled={busy}
                  title="Toggle paid / planned"
                  onClick={() =>
                    mutate({ action: "update-cost", costId: cost.id, status: cost.status === "paid" ? "planned" : "paid" })
                  }
                  style={{ cursor: "pointer", border: "none" }}
                >
                  {cost.status === "paid" ? "Paid" : "Planned"}
                </button>
              </td>
              <td style={{ padding: "6px 8px", textAlign: "right" }}>
                <button
                  type="button"
                  className="text-button"
                  disabled={busy}
                  onClick={() => {
                    if (window.confirm(`Delete "${cost.label}"?`)) mutate({ action: "delete-cost", costId: cost.id });
                  }}
                >
                  Delete
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}
