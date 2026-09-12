"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { OfflineBanner } from "../../components/offline-banner";
import { BusinessRelated } from "../../components/business-related";
import { EmptyState, FormGrid, FormRow, PageHeader, Panel, Button } from "../../components/ui";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import { hubHref } from "../../lib/nav/hubs";
import { withOrgHref } from "../../lib/nav/product-nav";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../lib/offline/feature-cache";
import { assignedTierLabel } from "../../lib/sponsor-tier-calculator";
import type { SponsorTierCalculatorView } from "../../lib/sponsor-tier-calculator/compute-sponsor-tier-calculator";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function usd(value: number): string {
  return `$${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

type LiveView = Extract<SponsorTierCalculatorView, { status: "live" }>;
type Mutate = (payload: Record<string, unknown>) => void;

function isSponsorTierView(value: unknown): value is SponsorTierCalculatorView {
  if (!value || typeof value !== "object") return false;
  const status = (value as { status?: unknown }).status;
  return status === "setup_required" || status === "live";
}

function responseError(data: unknown): string {
  return data && typeof data === "object" && "error" in data && typeof data.error === "string"
    ? data.error
    : "";
}

function sponsorTierCacheOrg(data: SponsorTierCalculatorView, orgHint: string): string {
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

async function persistSponsorTierSnapshot(
  orgHint: string,
  seasonHint: string,
  data: SponsorTierCalculatorView,
): Promise<void> {
  const cacheOrg = sponsorTierCacheOrg(data, orgHint);
  if (!cacheOrg) return;
  const seasonKey = String(data.seasonYear);
  try {
    await putFeatureSnapshot("sponsor-tier-calculator", cacheOrg, data, seasonHint || seasonKey);
    if (!orgHint) await putFeatureSnapshot("sponsor-tier-calculator", "_", data, seasonHint || seasonKey);
  } catch {
    // Live Tier calculator already painted; IndexedDB is best-effort.
  }
}

function SponsorTierRelated({ orgId }: { orgId?: string | null }) {
  if (!orgId) return null;
  return (
    <BusinessRelated
      orgId={orgId}
      include={["sponsors", "grants", "writer", "fundraisers"]}
      ariaLabel="Related business tools"
    />
  );
}

function SponsorTierNextActions({ orgId }: { orgId: string }) {
  const actions = [
    {
      id: "sponsors",
      label: "Open Sponsors",
      detail: "Record gifts so this calculator can match a giving level.",
      href: hubHref("/business", "sponsors", orgId),
      primary: true,
    },
    {
      id: "calendar",
      label: "Open Grant calendar",
      detail: "Deadlines for grants sit next to sponsor giving levels.",
      href: withOrgHref("/team/grants/calendar", orgId),
    },
    {
      id: "writer",
      label: "Open Writer",
      detail: "Draft the one-pager that names the tier you just matched.",
      href: withOrgHref("/writer", orgId),
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

export default function SponsorTierCalculatorClient() {
  const [view, setView] = useState<SponsorTierCalculatorView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  // Kept so an expired session offers sign-in instead of a Retry that cannot work.
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [season, setSeason] = useState<number | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const viewRef = useRef<SponsorTierCalculatorView | null>(null);
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
      const cached = await getFeatureSnapshot<SponsorTierCalculatorView>(
        "sponsor-tier-calculator",
        orgHint || "_",
        seasonHint,
      );
      if (!viewRef.current && cached?.data && isSponsorTierView(cached.data)) {
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
    setErrorStatus(null);
    setErrorMessage(null);
    setError("");
    try {
      const query = new URLSearchParams();
      if (orgHint) query.set("orgId", orgHint);
      if (seasonQuery) query.set("season", String(seasonQuery));
      const response = await fetch(
        `/api/sponsor-tier-calculator${query.toString() ? `?${query.toString()}` : ""}`,
        { cache: "no-store", signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS) },
      );
      const data: unknown = await response.json().catch(() => null);
      if (response.status === 401 || response.status === 403) {
        setView(null);
        setFromCache(false);
        setCachedAt(null);
        setFetchFailed(true);
        setErrorStatus(response.status);
        setErrorMessage(responseError(data) || null);
        return;
      }
      if (!response.ok || !isSponsorTierView(data)) {
        if (hadCache || viewRef.current) {
          setFromCache(true);
          setError("Could not refresh Tier calculator. Showing the last copy on this device.");
          setFetchFailed(false);
          return;
        }
        setFetchFailed(true);
        setErrorStatus(response.status);
        setErrorMessage(responseError(data) || null);
        return;
      }
      setView(data);
      setSeason(data.seasonYear);
      setFromCache(false);
      setCachedAt(null);
      await persistSponsorTierSnapshot(orgHint, seasonHint, data);
    } catch {
      if (hadCache || viewRef.current) {
        setFromCache(true);
        setError("Could not refresh Tier calculator. Showing the last copy on this device.");
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
      void fetch("/api/sponsor-tier-calculator", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId, seasonYear: season ?? undefined, ...payload }),
        signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
      })
        .then(async (response) => {
          const data: unknown = await response.json().catch(() => null);
          if (!response.ok || !isSponsorTierView(data)) {
            setError(responseError(data) || "Something went wrong.");
            return;
          }
          setView(data);
          setSeason(data.seasonYear);
          setFromCache(false);
          void persistSponsorTierSnapshot(orgId, String(data.seasonYear), data);
        })
        .catch(() => setError("Network error — please try again."))
        .finally(() => setBusy(false));
    },
    [orgId, season, busy],
  );

  const header = (
    <PageHeader
      breadcrumbs={
        <>
          <a href={orgId ? `/business?orgId=${encodeURIComponent(orgId)}` : "/business"}>Business</a>
          {" / Tier calculator"}
        </>
      }
      title="Tier calculator"
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
        <SponsorTierRelated orgId={orgId} />
      </div>
    </PageHeader>
  );

  if (!view) {
    const failure = fetchFailed
      ? loadFailureCopy(
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
        )
      : null;
    return (
      <main className="module-page">
        {header}
        <OfflineBanner feature="Tier calculator" fromCache={fromCache} cachedAt={cachedAt} />
        <EmptyState
          soft
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
          <OfflineBanner feature="Tier calculator" fromCache={fromCache} cachedAt={cachedAt} />
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
      return (
        <main className="module-page">
          {header}
          <OfflineBanner feature="Tier calculator" fromCache={fromCache} cachedAt={cachedAt} />
          {error ? (
            <p className="telemetry-status" role="alert">
              {error}
            </p>
          ) : null}
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
            {orgId ? <SponsorTierNextActions orgId={orgId} /> : null}
          </div>
        </main>
      );
    default: {
      view satisfies never;
      return null;
    }
  }
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
          <Button variant="primary" type="submit" disabled={busy || !form.name.trim()}>
            Save tier
          </Button>
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
              >
                <Button as="a" variant="primary" href={hubHref("/business", "sponsors", view.orgId)}>
                  Open Sponsors
                </Button>
              </EmptyState>
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
