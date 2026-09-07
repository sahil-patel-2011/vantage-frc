"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState, FormGrid, FormRow, PageHeader, Panel } from "../../components/ui";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";
import { assignedTierLabel } from "../../lib/sponsor-tier-calculator";
import type { SponsorTierCalculatorView } from "../../lib/sponsor-tier-calculator/compute-sponsor-tier-calculator";

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function usd(value: number): string {
  return `$${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

type LiveView = Extract<SponsorTierCalculatorView, { status: "live" }>;

export default function SponsorTierCalculatorClient() {
  const [view, setView] = useState<SponsorTierCalculatorView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  // Kept so an expired session offers sign-in instead of a Retry that cannot work.
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [season, setSeason] = useState<number | null>(null);

  const orgId = view && "orgId" in view ? view.orgId : null;

  const load = useCallback((seasonOverride?: number) => {
    setFetchFailed(false);
    setErrorStatus(null);
    setErrorMessage(null);
    setError("");
    const params = new URLSearchParams(window.location.search);
    const urlOrg = params.get("orgId");
    const seasonQuery = seasonOverride ?? (params.get("season") ? Number(params.get("season")) : null);
    const query = new URLSearchParams();
    if (urlOrg) query.set("orgId", urlOrg);
    if (seasonQuery) query.set("season", String(seasonQuery));
    void fetch(`/api/sponsor-tier-calculator${query.toString() ? `?${query.toString()}` : ""}`)
      .then(async (response) => {
        const data = (await response.json()) as SponsorTierCalculatorView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setErrorStatus(response.status);
          setErrorMessage("error" in data && data.error ? data.error : null);
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
        const response = await fetch("/api/sponsor-tier-calculator", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, seasonYear: season ?? undefined, ...payload }),
        });
        const data = (await response.json()) as SponsorTierCalculatorView | { error?: string };
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
            <a href={orgId ? `/business?orgId=${encodeURIComponent(orgId)}` : "/business"}>Business</a>
            {" / Sponsor Tier Calculator"}
          </>
        }
        title="Sponsor Tier Calculator"
        description="Define giving-level tiers and recognition benefits, then see which sponsors qualify and what benefits are still owed — computed from recorded contributions only."
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
            <a className="app-button secondary" href={`/business?orgId=${encodeURIComponent(orgId)}&tab=sponsors`}>
              Business · Sponsors
            </a>
          ) : null}
        </div>
      </PageHeader>

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
              message: errorMessage,
              online: typeof navigator === "undefined" ? true : navigator.onLine,
            }),
            {
              nextPath:
                typeof window === "undefined"
                  ? null
                  : `${window.location.pathname}${window.location.search}`,
              message: errorMessage,
            },
          );
          return (
            <EmptyState title={copy.title} description={copy.description}>
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
            </EmptyState>
          );
        })()
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
                <a href={step.href} aria-label={`Open ${step.label}`}>Open</a>
              </li>
            ))}
          </ol>
        </EmptyState>
      ) : (
        <div style={{ display: "grid", gap: 16 }}>
          <SummaryTiles view={view} />
          <TierDefinitionsPanel view={view} busy={busy} mutate={mutate} />
          {view.tiers.length === 0 ? (
            <EmptyState
              badge="No tiers defined"
              badgeTone="setup"
              title="Define your sponsor tiers to unlock the calculator"
              description="Add at least one tier above (e.g. Bronze at $500) so sponsors can be matched against giving thresholds."
            />
          ) : (
            <SponsorRowsPanel view={view} busy={busy} mutate={mutate} />
          )}
        </div>
      )}
    </main>
  );
}

function SummaryTiles({ view }: { view: LiveView }) {
  const { summary } = view;
  const tiles = [
    { label: "Sponsors", value: String(summary.totalSponsors) },
    { label: "Raised this season", value: usd(summary.totalRaisedUsd) },
    { label: "Below lowest tier", value: String(summary.belowLowestTierCount) },
    { label: "Benefits fulfilled", value: pct(summary.benefitsFulfilledRate) },
  ];
  return (
    <Panel>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12 }}>
        {tiles.map((tile) => (
          <div key={tile.label}>
            <strong style={{ fontSize: "1.6rem", display: "block" }}>{tile.value}</strong>
            <span className="app-muted">{tile.label}</span>
          </div>
        ))}
      </div>
      {summary.tierCounts.length > 0 ? (
        <div style={{ marginTop: 12, display: "flex", flexWrap: "wrap", gap: 10 }}>
          {summary.tierCounts.map((tier) => (
            <span key={tier.tierId} className="app-badge">
              {tier.tierName}: {tier.count}
            </span>
          ))}
        </div>
      ) : null}
    </Panel>
  );
}

function TierDefinitionsPanel({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const empty = useMemo(() => ({ name: "", minAmountUsd: "", benefits: "", sortOrder: "" }), []);
  const [form, setForm] = useState(empty);
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }));

  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>Tier definitions</h2>
      {view.tiers.length > 0 ? (
        <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 8, marginBottom: 12 }}>
          {view.tiers.map((tier) => (
            <li
              key={tier.id}
              style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}
            >
              <div>
                <strong>{tier.name}</strong>
                <small className="app-muted" style={{ display: "block" }}>
                  {usd(tier.minAmountUsd)}+
                  {tier.benefits.length ? ` · ${tier.benefits.join(", ")}` : ""}
                </small>
              </div>
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() => {
                  if (window.confirm(`Delete tier "${tier.name}"?`)) {
                    mutate({ action: "delete-tier", tierId: tier.id });
                  }
                }}
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!form.name.trim()) return;
          mutate({
            action: "save-tier",
            name: form.name,
            minAmountUsd: Number(form.minAmountUsd) || 0,
            benefits: form.benefits
              .split(",")
              .map((b) => b.trim())
              .filter(Boolean),
            sortOrder: Number(form.sortOrder) || 0,
          });
          setForm(empty);
        }}
        style={{ display: "grid", gap: 10 }}
      >
        <FormGrid min={160}>
          <FormRow label="Tier name">
            <input value={form.name} onChange={set("name")} placeholder="Gold" required />
          </FormRow>
          <FormRow label="Minimum giving (USD)">
            <input type="number" min={0} value={form.minAmountUsd} onChange={set("minAmountUsd")} />
          </FormRow>
          <FormRow label="Sort order (optional)">
            <input type="number" value={form.sortOrder} onChange={set("sortOrder")} />
          </FormRow>
        </FormGrid>
        <FormRow label="Benefits (comma-separated)" wide>
          <input
            value={form.benefits}
            onChange={set("benefits")}
            placeholder="Logo on robot, Banner at events, Newsletter shoutout"
          />
        </FormRow>
        <div>
          <button type="submit" className="app-button" disabled={busy || !form.name.trim()}>
            Save tier
          </button>
        </div>
      </form>
    </Panel>
  );
}

function SponsorRowsPanel({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  if (view.rows.length === 0) {
    return (
      <EmptyState
        badge="No sponsors yet"
        badgeTone="setup"
        title="No active sponsors on file"
        description="Add sponsors and record contributions in Business · Sponsors to see tier matches here."
      />
    );
  }
  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>Sponsors this season</h2>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 14 }}>
        {view.rows.map((row) => (
          <li key={row.sponsorId} className="app-card soft-panel" style={{ display: "grid", gap: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
              <div>
                <strong>{row.sponsorName}</strong>
                <small className="app-muted" style={{ display: "block" }}>
                  Assigned: {assignedTierLabel(row.assignedTier)} · Given: {usd(row.totalGivenUsd)}
                </small>
              </div>
              <div style={{ textAlign: "right" }}>
                <span className="app-badge">
                  {row.calculatedTierName ? `Qualifies: ${row.calculatedTierName}` : "Below lowest tier"}
                </span>
                {row.nextTierName && row.amountToNextTierUsd != null ? (
                  <small className="app-muted" style={{ display: "block" }}>
                    {usd(row.amountToNextTierUsd)} to {row.nextTierName}
                  </small>
                ) : null}
              </div>
            </div>
            {row.benefits.length > 0 ? (
              <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 4 }}>
                {row.benefits.map((benefit) => (
                  <li
                    key={benefit.benefit}
                    style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}
                  >
                    <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <input
                        type="checkbox"
                        checked={benefit.fulfilled}
                        disabled={busy}
                        onChange={(event) =>
                          mutate({
                            action: "set-fulfillment",
                            sponsorId: row.sponsorId,
                            benefit: benefit.benefit,
                            fulfilled: event.target.checked,
                            notes: benefit.notes ?? undefined,
                          })
                        }
                      />
                      {benefit.benefit}
                    </label>
                    {benefit.fulfilledAt ? (
                      <small className="app-muted">{new Date(benefit.fulfilledAt).toLocaleDateString()}</small>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <small className="app-muted">No benefits owed at the current tier.</small>
            )}
          </li>
        ))}
      </ul>
    </Panel>
  );
}
