"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { OfflineBanner } from "../../components/offline-banner";
import { BusinessRelated } from "../../components/business-related";
import { EmptyState, FormGrid, FormRow, PageHeader, Panel, Button } from "../../components/ui";
import { COSTS_RELATED_INCLUDE } from "../../lib/business/business-related";
import { costsNextActions } from "../../lib/business/costs-next-actions";
import { costCategoryLabel, subscriptionCadenceLabel, usd } from "../../lib/costs";
import {
  COST_CATEGORIES,
  COST_STATUSES,
  SUBSCRIPTION_CADENCES,
  type CostsView,
} from "../../lib/costs/compute-costs";
import { formatBudgetPctDisplay, formatCostUsdDisplay } from "../../lib/costs/costs-related";
import type {
  BudgetStatus,
  CostCategory,
  CostStatus,
  SeasonCost,
  SubscriptionCadence,
  SubscriptionWithAnnual,
} from "../../lib/costs/types";
import { hubHref } from "../../lib/nav/hubs";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../lib/offline/feature-cache";
import { withOrgHref } from "../../lib/nav/product-nav";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";
import "./costs.css";

type LiveView = Extract<CostsView, { status: "live" }>;
type Mutate = (payload: Record<string, unknown>) => void;

function isCostsView(value: unknown): value is CostsView {
  if (!value || typeof value !== "object") return false;
  const status = (value as { status?: unknown }).status;
  return status === "setup_required" || status === "live";
}

function costsCacheOrg(data: CostsView, orgHint: string): string {
  if (typeof data.orgId === "string" && data.orgId.trim()) return data.orgId;
  return orgHint;
}

async function persistCostsSnapshot(orgHint: string, seasonHint: string, data: CostsView): Promise<void> {
  const cacheOrg = costsCacheOrg(data, orgHint);
  if (!cacheOrg) return;
  const seasonKey = String(data.seasonYear);
  try {
    await putFeatureSnapshot("costs", cacheOrg, data, seasonHint || seasonKey);
    if (!orgHint) await putFeatureSnapshot("costs", "_", data, seasonHint || seasonKey);
  } catch {
    // Live Season Costs already painted; IndexedDB is best-effort.
  }
}

const SOURCE_COLOR: Record<string, string> = {
  season: "#1457d9",
  subscriptions: "#7a4fd6",
  api: "#1f7a3d",
};

function statusTone(status: BudgetStatus): string {
  if (status === "over") return "#c02626";
  if (status === "watch") return "#b26a00";
  if (status === "healthy") return "#1f7a3d";
  return "inherit";
}

function CostsRelated({ orgId }: { orgId: string }) {
  return (
    <BusinessRelated
      orgId={orgId}
      active="costs"
      include={COSTS_RELATED_INCLUDE}
      ariaLabel="Related costs and finance tools"
    />
  );
}

function NextActions({
  orgId,
  seasonYear,
  costCount,
  subscriptionCount,
  budgetUsd,
  overBudget,
}: {
  orgId?: string | null;
  seasonYear?: number;
  costCount: number;
  subscriptionCount: number;
  budgetUsd: number | null;
  overBudget: boolean;
}) {
  const actions = costsNextActions({
    orgId,
    seasonYear,
    costCount,
    subscriptionCount,
    budgetUsd,
    overBudget,
  });
  return (
    <section className="costs-next-actions app-card soft-panel" aria-label="Next actions">
      <header>
        <h2>Next actions</h2>
        <p>Each one opens the page where you finish the work.</p>
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

export default function CostsClient() {
  const [view, setView] = useState<CostsView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  // Kept so an expired session offers sign-in instead of a Retry that cannot work.
  const [loadError, setLoadError] = useState("");
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [season, setSeason] = useState<number | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const viewRef = useRef<CostsView | null>(null);
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
      const cached = await getFeatureSnapshot<CostsView>("costs", orgHint || "_", seasonHint);
      if (!viewRef.current && cached?.data && isCostsView(cached.data)) {
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
    setError("");
    setLoadError("");
    setErrorStatus(null);
    try {
      const query = new URLSearchParams();
      if (orgHint) query.set("orgId", orgHint);
      if (seasonQuery) query.set("season", String(seasonQuery));
      const response = await fetch(`/api/costs${query.toString() ? `?${query.toString()}` : ""}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
      });
      const data: unknown = await response.json().catch(() => null);
      if (response.status === 401 || response.status === 403) {
        setView(null);
        setFromCache(false);
        setCachedAt(null);
        setFetchFailed(true);
        setErrorStatus(response.status);
        setLoadError(
          data && typeof data === "object" && "error" in data && typeof data.error === "string"
            ? data.error
            : "",
        );
        return;
      }
      if (!response.ok || !isCostsView(data)) {
        if (hadCache || viewRef.current) {
          setFromCache(true);
          setError("Could not refresh Season Costs. Showing the last copy on this device.");
          setFetchFailed(false);
          return;
        }
        setFetchFailed(true);
        setErrorStatus(response.status);
        setLoadError(
          data && typeof data === "object" && "error" in data && typeof data.error === "string"
            ? data.error
            : "",
        );
        return;
      }
      setView(data);
      setSeason(data.seasonYear);
      setFromCache(false);
      setCachedAt(null);
      await persistCostsSnapshot(orgHint, seasonHint, data);
    } catch {
      if (hadCache || viewRef.current) {
        setFromCache(true);
        setError("Could not refresh Season Costs. Showing the last copy on this device.");
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
      void fetch("/api/costs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId, seasonYear: season ?? undefined, ...payload }),
        signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
      })
        .then(async (response) => {
          const data: unknown = await response.json().catch(() => null);
          if (!response.ok || !isCostsView(data)) {
            setError(
              data && typeof data === "object" && "error" in data && typeof data.error === "string"
                ? data.error
                : "Something went wrong.",
            );
            return;
          }
          setView(data);
          setSeason(data.seasonYear);
          setFromCache(false);
          void persistCostsSnapshot(orgId, String(data.seasonYear), data);
        })
        .catch(() => setError("Network error — please try again."))
        .finally(() => setBusy(false));
    },
    [orgId, season, busy],
  );

  if (!view) {
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
            message:
              loadError || "A network or server issue prevented loading. Try again.",
          },
        )
      : null;
    return (
      <main className="module-page costs-page">
        <PageHeader
          breadcrumbs="Business / Season Costs"
          title="Season Costs"
          description="Real-world spend against a season budget."
        />
        <OfflineBanner feature="Season Costs" fromCache={fromCache} cachedAt={cachedAt} />
        <EmptyState
          soft
          title={failure ? failure.title : "Loading season costs…"}
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

  if (view.status === "setup_required") {
    return (
      <main className="module-page costs-page">
        <PageHeader
          breadcrumbs="Business / Season Costs"
          title="Season Costs"
          description="Track real event spend, subscriptions, and live AI/API usage — separate from Business purchase approvals."
        >
          {view.orgId ? <CostsRelated orgId={view.orgId} /> : null}
        </PageHeader>
        <OfflineBanner feature="Season Costs" fromCache={fromCache} cachedAt={cachedAt} />
        {error ? (
          <p className="costs-alert" role="alert">
            {error}
          </p>
        ) : null}
        <EmptyState soft badge="Needs setup" badgeTone="setup" title={view.message}>
          {view.steps[0] ? (
            <Button as="a" variant="primary" href={view.steps[0].href}>
              {view.steps[0].label}
            </Button>
          ) : null}
        </EmptyState>
      </main>
    );
  }

  const hasSpend = view.costs.length > 0 || view.subscriptions.items.length > 0 || view.apiUsageUsd > 0;

  return (
    <main className="module-page costs-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={orgId ? `/business?orgId=${encodeURIComponent(orgId)}` : "/business"}>Business</a>
            {" / Season Costs"}
          </>
        }
        title="Season Costs"
        description="Real-world spend, subscriptions, and live AI/API usage against one season budget — from logged rows only. Approved purchase requests live under Orders."
      >
        <div className="costs-header-actions">
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
          <Button as="a" variant="secondary" href={hubHref("/business", "budget", orgId)}>
            Business budget
          </Button>
          <Button as="a" variant="secondary" href={hubHref("/business", "orders", orgId)}>
            Orders
          </Button>
          <Button as="a" variant="secondary" href={withOrgHref("/fundraisers", orgId)}>
            Fundraisers
          </Button>
        </div>
      </PageHeader>
      <OfflineBanner feature="Season Costs" fromCache={fromCache} cachedAt={cachedAt} />

      {orgId ? <CostsRelated orgId={orgId} /> : null}

      {error ? (
        <p className="costs-alert" role="alert">
          {error}
        </p>
      ) : null}

      <NextActions
        orgId={orgId}
        seasonYear={view.seasonYear}
        costCount={view.costs.length}
        subscriptionCount={view.subscriptions.items.length}
        budgetUsd={view.budget.totalBudgetUsd}
        overBudget={view.summary.overBudget}
      />

      <AllInPanel view={view} hasSpend={hasSpend} />
      <BudgetPanel view={view} busy={busy} mutate={mutate} />
      {view.insight ? <AssistantPanel view={view} /> : null}
      <SubscriptionsSection view={view} busy={busy} mutate={mutate} />
      <AddCostForm busy={busy} mutate={mutate} />
      {view.summary.byCategory.length > 0 ? <CategoryBreakdown view={view} /> : null}
      {view.costs.length === 0 ? (
        <EmptyState
          soft
          title="No season costs logged yet"
          description="Start with registration and event fees, then add purchases as you go. Totals stay at real $0 until you record them."
        >
          <div className="costs-row-links">
            <a href={hubHref("/business", "orders", orgId)}>Orders →</a>
            <a href={withOrgHref("/fundraisers", orgId)}>Fundraisers →</a>
            <a href={hubHref("/business", "budget", orgId)}>Business budget →</a>
          </div>
        </EmptyState>
      ) : (
        <CostLog view={view} busy={busy} mutate={mutate} />
      )}
    </main>
  );
}

function AllInPanel({ view, hasSpend }: { view: LiveView; hasSpend: boolean }) {
  const all = view.allCosts;
  const max = Math.max(all.grandTotal, 1);
  return (
    <Panel className="costs-panel" aria-label="Total season cost">
      <div className="costs-allin-head">
        <div>
          <span className="app-muted">All-in season cost ({view.seasonYear})</span>
          <strong>{formatCostUsdDisplay(all.grandTotal, hasSpend || all.grandTotal > 0)}</strong>
        </div>
        <p className="costs-allin-note">
          Everything from logged season fees + annualized subscriptions + live AI/API usage. Approved purchase
          requests live under Orders — they are not invented here.
        </p>
      </div>
      {hasSpend || all.grandTotal > 0 ? (
        <ul className="costs-breakdown">
          {all.breakdown.map((row) => (
            <li key={row.key}>
              <span>
                <span
                  className="costs-swatch"
                  aria-hidden="true"
                  style={{ background: SOURCE_COLOR[row.key] }}
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
      ) : (
        <p className="app-muted" style={{ margin: 0 }}>
          All-in stays blank until you log a cost, subscription, or have real AI/API usage this season.
        </p>
      )}
      {view.apiUsageUsd > 0 ? (
        <small className="app-muted">
          App AI/API usage ({usd(view.apiUsageUsd)}) is read live from your usage ledger for this season — separate from
          the real-world budget below.
        </small>
      ) : null}
    </Panel>
  );
}

function BudgetPanel({ view, busy, mutate }: { view: LiveView; busy: boolean; mutate: Mutate }) {
  const { budget, summary } = view;
  const [budgetInput, setBudgetInput] = useState("");
  const [aiAssist, setAiAssist] = useState(false);
  const hasBudget = budget.totalBudgetUsd != null;

  useEffect(() => {
    setBudgetInput(budget.totalBudgetUsd == null ? "" : String(budget.totalBudgetUsd));
    setAiAssist(budget.aiAssistEnabled);
  }, [budget.totalBudgetUsd, budget.aiAssistEnabled, view.computedAt]);

  // The season budget moved behind the `manage_budget` capability in 0621, so for anyone
  // below mentor level the row is not returned at all. Rendering the usual
  // "no budget set / set one" card here would state something this session
  // cannot know and offer a control the database would refuse.
  if (!view.canManageBudget) {
    return (
      <Panel className="costs-panel">
        <h2>Season budget</h2>
        <p className="app-muted">
          The season budget is visible to mentors only — the team Owner and Admins, plus anyone an
          owner has granted budget access. Whether one is set is not shown here either way. The
          season costs below are the team&rsquo;s real recorded spend and stay open to everyone.
        </p>
        <p className="app-muted">
          Need a part? <a href="/part-requests">Send a part request</a> — that does not need budget
          access.
        </p>
      </Panel>
    );
  }

  const pct = summary.pctUsed == null ? null : Math.min(1.2, summary.pctUsed);
  const barColor = summary.overBudget ? "#c02626" : (pct ?? 0) >= 0.85 ? "#b26a00" : "#1f7a3d";

  const saveBudget = (nextAi?: boolean) =>
    mutate({
      action: "set-budget",
      totalBudgetUsd: budgetInput === "" ? undefined : budgetInput,
      aiAssistEnabled: nextAi ?? aiAssist,
    });

  const tiles = [
    {
      label: "Season budget",
      value: formatCostUsdDisplay(budget.totalBudgetUsd, hasBudget),
      tone: "",
    },
    {
      label: "Committed (real-world)",
      value: usd(summary.totalCommitted),
      tone: "",
    },
    {
      label: "Remaining",
      value: formatCostUsdDisplay(summary.remaining, hasBudget),
      tone: summary.overBudget ? "critical" : "",
    },
    {
      label: "Fixed fees",
      value: usd(summary.feesTotal),
      tone: "",
    },
  ];

  return (
    <Panel className="costs-panel">
      <section className="costs-summary" aria-label="Season budget summary">
        {tiles.map((tile) => (
          <article key={tile.label} className={`costs-summary-tile${tile.tone ? ` ${tile.tone}` : ""}`}>
            <strong>{tile.value}</strong>
            <span>{tile.label}</span>
          </article>
        ))}
      </section>

      <div className="costs-progress-wrap">
        <div className={`costs-progress-bar${pct == null ? " empty" : ""}`} aria-hidden="true">
          <i
            style={{
              width: pct == null ? "0%" : `${Math.max(2, (pct / 1.2) * 100)}%`,
              background: barColor,
            }}
          />
        </div>
        <small className="app-muted">
          {pct == null
            ? "Set a season budget to track % committed — stays blank until then"
            : `${formatBudgetPctDisplay(summary.pctUsed)} of budget committed${summary.overBudget ? " · over budget" : ""}`}
        </small>
      </div>

      <form
        className="costs-budget-form"
        onSubmit={(event) => {
          event.preventDefault();
          saveBudget();
        }}
      >
        <label>
          <span>Season budget ($)</span>
          <input
            type="number"
            min={0}
            step="1"
            value={budgetInput}
            onChange={(event) => setBudgetInput(event.target.value)}
            placeholder="e.g. 25000"
          />
        </label>
        <Button variant="primary" type="submit" disabled={busy}>
          Save budget
        </Button>
        <label
          className="costs-ai-toggle"
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
            <small>Opt-in. Turns your budget into plain-language guidance to stay on track.</small>
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
      className="costs-assistant app-card soft-panel"
      aria-label="Finance assistant"
      style={{ borderLeft: `3px solid ${statusTone(insight.status)}` }}
    >
      <header>
        <span className="app-badge" style={{ background: statusTone(insight.status), color: "#fff" }}>
          {insight.status === "over"
            ? "Over budget"
            : insight.status === "watch"
              ? "Watch"
              : insight.status === "healthy"
                ? "On track"
                : "Set up"}
        </span>
        <h2>Finance assistant</h2>
      </header>
      <p>{insight.headline}</p>
      <ul>
        {insight.recommendations.map((rec) => (
          <li key={rec}>{rec}</li>
        ))}
      </ul>
      <small className="app-muted">Automated analysis of your own budget data — rule-based, kept within your team.</small>
    </section>
  );
}

function SubscriptionsSection({ view, busy, mutate }: { view: LiveView; busy: boolean; mutate: Mutate }) {
  const subs = view.subscriptions;
  return (
    <section className="app-card soft-panel costs-panel">
      <div className="costs-subs-head">
        <h2>Subscriptions</h2>
        <span className="app-muted">
          {subs.activeCount} active · <strong>{usd(subs.totalAnnual)}</strong>/yr
        </span>
      </div>

      {subs.items.length > 0 ? (
        <ul className="costs-subs-list">
          {subs.items.map((sub: SubscriptionWithAnnual) => (
            <li key={sub.id} className={sub.active ? undefined : "inactive"}>
              <div>
                <strong>{sub.name}</strong>
                {sub.provider ? <small className="app-muted"> · {sub.provider}</small> : null}
                <small className="app-muted" style={{ display: "block" }}>
                  {usd(sub.amountUsd)} {subscriptionCadenceLabel(sub.cadence).toLowerCase()} · {usd(sub.annualUsd)}/yr
                </small>
              </div>
              <div className="costs-subs-actions">
                <button
                  type="button"
                  className={`costs-badge ${sub.active ? "good" : "inactive"}`}
                  disabled={busy}
                  title="Toggle active"
                  onClick={() => mutate({ action: "update-subscription", subscriptionId: sub.id, active: !sub.active })}
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
          Add recurring costs — CAD licenses, hosting, software — to see the true all-in season total. Stays empty until you add one.
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
      className="costs-sub-form"
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
    >
      <label style={{ flex: "2 1 160px" }}>
        <span>Subscription</span>
        <input value={form.name} onChange={set("name")} placeholder="Onshape, Fusion, hosting…" required />
      </label>
      <label>
        <span>Provider (optional)</span>
        <input value={form.provider} onChange={set("provider")} />
      </label>
      <label style={{ width: 110 }}>
        <span>Amount ($)</span>
        <input type="number" min={0} step="0.01" value={form.amountUsd} onChange={set("amountUsd")} required />
      </label>
      <label>
        <span>Cadence</span>
        <select value={form.cadence} onChange={set("cadence")}>
          {SUBSCRIPTION_CADENCES.map((cadence) => (
            <option key={cadence} value={cadence}>
              {subscriptionCadenceLabel(cadence)}
            </option>
          ))}
        </select>
      </label>
      <Button variant="secondary" type="submit" disabled={busy || !form.name.trim()}>
        Add subscription
      </Button>
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
      className="costs-panel"
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
    >
      <h2>Add cost</h2>
      <p>Amounts come from what you enter.</p>
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
      <div className="costs-form-actions">
        <Button variant="primary" type="submit" disabled={busy || !form.label.trim() || !form.incurredOn}>
          Add cost
        </Button>
      </div>
    </Panel>
  );
}

function CategoryBreakdown({ view }: { view: LiveView }) {
  const { byCategory } = view.summary;
  const max = Math.max(...byCategory.map((c) => c.committed), 1);
  return (
    <section className="app-card soft-panel costs-panel">
      <h2>By category</h2>
      <p>From logged cost rows only.</p>
      <ul className="costs-cat-list">
        {byCategory.map((row) => (
          <li key={row.category}>
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
  return (
    <Panel className="costs-panel costs-log">
      <h2>Cost log</h2>
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Item</th>
            <th>Category</th>
            <th style={{ textAlign: "right" }}>Amount</th>
            <th>Status</th>
            <th aria-label="actions" />
          </tr>
        </thead>
        <tbody>
          {view.costs.map((cost: SeasonCost) => (
            <tr key={cost.id}>
              <td style={{ whiteSpace: "nowrap" }}>{cost.incurredOn}</td>
              <td>
                <strong>{cost.label}</strong>
                {cost.vendor ? <span className="vendor">{cost.vendor}</span> : null}
              </td>
              <td>{costCategoryLabel(cost.category)}</td>
              <td className="amount">{usd(cost.amountUsd)}</td>
              <td>
                <button
                  type="button"
                  className={`costs-badge ${cost.status === "paid" ? "paid" : "planned"}`}
                  disabled={busy}
                  title="Toggle paid / planned"
                  onClick={() =>
                    mutate({ action: "update-cost", costId: cost.id, status: cost.status === "paid" ? "planned" : "paid" })
                  }
                >
                  {cost.status === "paid" ? "Paid" : "Planned"}
                </button>
              </td>
              <td style={{ textAlign: "right" }}>
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
