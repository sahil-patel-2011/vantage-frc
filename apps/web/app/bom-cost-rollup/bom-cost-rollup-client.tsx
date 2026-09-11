"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { OfflineBanner } from "../../components/offline-banner";
import { EmptyState, FormGrid, FormRow, PageHeader, Panel, Button } from "../../components/ui";
import { ExportButton, type CsvColumn } from "../../components/ui/export-button";
import { bomCategoryLabel, bomSourceLabel, bomStatusLabel } from "../../lib/bom-cost-rollup";
import type { BomCostRollupView } from "../../lib/bom-cost-rollup/compute-bom-cost-rollup";
import type { BomCategory, BomLineItem, BomStatus } from "../../lib/bom-cost-rollup/types";
import { hubHref } from "../../lib/nav/hubs";
import { withOrgHref } from "../../lib/nav/product-nav";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../lib/offline/feature-cache";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";

type LiveView = Extract<BomCostRollupView, { status: "live" }>;

const CATEGORIES: BomCategory[] = ["purchased", "raw_material", "fastener", "electronics", "other"];

function usd(value: number): string {
  return value.toLocaleString(undefined, { style: "currency", currency: "USD" });
}

/**
 * CSV shape of the BOM. Dollar columns are raw numbers, NOT the "$1,234.56" strings the
 * table renders — a currency string with a thousands separator is exactly how a BOM
 * lands in a spreadsheet as text and stops summing.
 */
const BOM_CSV_COLUMNS: CsvColumn<BomLineItem>[] = [
  { key: "partName", header: "Part" },
  { key: "subsystem", header: "Subsystem" },
  { key: "category", header: "Category", value: (item) => bomCategoryLabel(item.category) },
  { key: "quantity", header: "Qty", value: (item) => item.quantity },
  { key: "unitCostUsd", header: "Unit cost USD", hint: "Raw number, no currency symbol", value: (item) => item.unitCostUsd },
  { key: "lineTotalUsd", header: "Line total USD", hint: "Raw number, no currency symbol", value: (item) => item.lineTotalUsd },
  { key: "source", header: "Source", hint: "Manual entry or CAD import", value: (item) => bomSourceLabel(item.source) },
  { key: "cadReference", header: "CAD reference", value: (item) => item.cadReference },
  { key: "seasonYear", header: "Season", value: (item) => item.seasonYear },
  { key: "notes", header: "Notes", value: (item) => item.notes },
  { key: "createdAt", header: "Added at", hint: "ISO-8601 UTC", value: (item) => item.createdAt },
];

function statusTone(status: BomStatus): string {
  if (status === "over") return "demo";
  if (status === "near") return "setup";
  return "good";
}

function isBomCostRollupView(value: unknown): value is BomCostRollupView {
  if (!value || typeof value !== "object") return false;
  const status = (value as { status?: unknown }).status;
  return status === "setup_required" || status === "live";
}

function responseError(data: unknown): string {
  return data && typeof data === "object" && "error" in data && typeof data.error === "string"
    ? data.error
    : "";
}

function bomCostRollupCacheOrg(data: BomCostRollupView, orgHint: string): string {
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

async function persistBomCostRollupSnapshot(
  orgHint: string,
  seasonHint: string,
  data: BomCostRollupView,
): Promise<void> {
  const cacheOrg = bomCostRollupCacheOrg(data, orgHint);
  if (!cacheOrg) return;
  const seasonKey = String(data.seasonYear);
  try {
    await putFeatureSnapshot("bom-cost-rollup", cacheOrg, data, seasonHint || seasonKey);
    if (!orgHint) await putFeatureSnapshot("bom-cost-rollup", "_", data, seasonHint || seasonKey);
  } catch {
    // Live BOM cost rollup already painted; IndexedDB is best-effort.
  }
}

function BomCostRollupRelated({ orgId }: { orgId?: string | null }) {
  return (
    <nav className="product-hub-related" aria-label="Related build tools">
      <Button as="a" variant="secondary" href={hubHref("/build", "budget-reconciler", orgId)}>
        Budget check
      </Button>
      <Button as="a" variant="secondary" href={hubHref("/business", "costs", orgId)}>
        Season costs
      </Button>
      <Button as="a" variant="secondary" href={withOrgHref("/inventory", orgId)}>
        Inventory
      </Button>
    </nav>
  );
}

function BomCostRollupNextActions({ orgId }: { orgId: string }) {
  const actions = [
    {
      id: "add",
      label: "Add a line item",
      detail: "Log a purchased part so the season total is real.",
      href: "#bom-cost-add",
      primary: true,
    },
    {
      id: "check",
      label: "Open Budget check",
      detail: "Weight and power drift sit next to this parts total.",
      href: hubHref("/build", "budget-reconciler", orgId),
      primary: false,
    },
    {
      id: "costs",
      label: "Open Season costs",
      detail: "Event fees and subscriptions are a separate spend log.",
      href: hubHref("/business", "costs", orgId),
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

export default function BomCostRollupClient() {
  const [view, setView] = useState<BomCostRollupView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  // Kept so an expired session offers sign-in instead of a Retry that cannot work.
  const [failureStatus, setFailureStatus] = useState<number | null>(null);
  const [failureMessage, setFailureMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const viewRef = useRef<BomCostRollupView | null>(null);
  viewRef.current = view;

  const orgId = view && "orgId" in view ? view.orgId : null;

  const load = useCallback(async (seasonOverride?: number) => {
    const params = new URLSearchParams(window.location.search);
    const orgHint = params.get("orgId")?.trim() ?? "";
    const seasonQuery = seasonOverride != null ? String(seasonOverride) : params.get("seasonYear");
    const seasonHint = seasonQuery && Number.isFinite(Number(seasonQuery)) ? seasonQuery : String(new Date().getFullYear());
    let hadCache = Boolean(viewRef.current);
    try {
      const cached = await getFeatureSnapshot<BomCostRollupView>("bom-cost-rollup", orgHint || "_", seasonHint);
      if (!viewRef.current && cached?.data && isBomCostRollupView(cached.data)) {
        setView(cached.data);
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
      if (seasonQuery) query.set("seasonYear", seasonQuery);
      const response = await fetch(`/api/bom-cost-rollup${query.toString() ? `?${query.toString()}` : ""}`, {
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
      if (!response.ok || !isBomCostRollupView(data)) {
        if (hadCache || viewRef.current) {
          setFromCache(true);
          setError("Could not refresh BOM cost rollup. Showing the last copy on this device.");
          setFetchFailed(false);
          return;
        }
        setFetchFailed(true);
        setFailureStatus(response.status);
        setFailureMessage(responseError(data));
        return;
      }
      setView(data);
      setFromCache(false);
      setCachedAt(null);
      await persistBomCostRollupSnapshot(orgHint, seasonHint, data);
    } catch {
      if (hadCache || viewRef.current) {
        setFromCache(true);
        setError("Could not refresh BOM cost rollup. Showing the last copy on this device.");
        setFetchFailed(false);
        return;
      }
      setFetchFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const mutate = useCallback(
    async (payload: Record<string, unknown>) => {
      if (!orgId || busy) return;
      setBusy(true);
      setError("");
      const seasonYear = view?.status === "live" ? view.seasonYear : undefined;
      try {
        const response = await fetch("/api/bom-cost-rollup", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, seasonYear, ...payload }),
          signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
        });
        const data: unknown = await response.json().catch(() => null);
        if (!response.ok || !isBomCostRollupView(data)) {
          setError(responseError(data) || "Something went wrong.");
          return;
        }
        setView(data);
        setFromCache(false);
        void persistBomCostRollupSnapshot(orgId, String(data.seasonYear), data);
      } catch {
        setError("Network error — please try again.");
      } finally {
        setBusy(false);
      }
    },
    [orgId, busy, view],
  );

  const buildHref = orgId ? `/build?orgId=${encodeURIComponent(orgId)}` : "/build";
  const header = (
    <PageHeader
      breadcrumbs={
        <>
          <a href={buildHref}>Build</a>
          {" / BOM cost rollup"}
        </>
      }
      title="BOM cost rollup"
      description="Roll up bill-of-materials line items — logged by hand or imported from CAD — against a season budget, broken down by subsystem and category."
    >
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
        {view?.status === "live" && view.seasons.length > 0 ? (
          <label className="app-muted" style={{ display: "flex", gap: 6, alignItems: "center" }}>
            Season
            <select value={view.seasonYear} onChange={(event) => void load(Number(event.target.value))}>
              {view.seasons.map((season) => (
                <option key={season} value={season}>
                  {season}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <BomCostRollupRelated orgId={orgId} />
      </div>
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
        <OfflineBanner feature="BOM cost rollup" fromCache={fromCache} cachedAt={cachedAt} />
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
          <OfflineBanner feature="BOM cost rollup" fromCache={fromCache} cachedAt={cachedAt} />
          {error ? (
            <p className="telemetry-status" role="alert">
              {error}
            </p>
          ) : null}
          <EmptyState badge="Setup required" badgeTone="setup" title={view.message}>
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
      <OfflineBanner feature="BOM cost rollup" fromCache={fromCache} cachedAt={cachedAt} />
      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}
      <BomCostRollupNextActions orgId={view.orgId} />
      <div style={{ display: "grid", gap: 16 }}>
        <SummaryTiles view={view} busy={busy} mutate={mutate} />
        <AddItemForm busy={busy} mutate={mutate} />
        <ItemsTable view={view} busy={busy} mutate={mutate} />
      </div>
    </main>
  );
}

function SummaryTiles({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const { summary } = view;
  const [budgetInput, setBudgetInput] = useState(String(summary.budgetUsd || ""));
  const tiles = [
    { label: "Total cost", value: usd(summary.totalCostUsd) },
    { label: "Budget", value: summary.budgetUsd > 0 ? usd(summary.budgetUsd) : "Not set" },
    { label: "Remaining", value: usd(summary.remainingUsd) },
    {
      label: "Budget used",
      value: summary.percentUsed == null ? "—" : `${Math.round(summary.percentUsed * 100)}%`,
    },
    { label: "Line items", value: String(summary.itemCount) },
  ];
  return (
    <Panel>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <span className={`app-badge ${statusTone(summary.status)}`}>{bomStatusLabel(summary.status)}</span>
        <form
          style={{ display: "flex", gap: 8, alignItems: "center" }}
          onSubmit={(event) => {
            event.preventDefault();
            mutate({ action: "set-budget", budgetUsd: Number(budgetInput) || 0 });
          }}
        >
          <label className="app-muted" style={{ display: "flex", gap: 6, alignItems: "center" }}>
            Season budget (USD)
            <input
              type="number"
              min={0}
              step="0.01"
              value={budgetInput}
              onChange={(event) => setBudgetInput(event.target.value)}
              style={{ width: 120 }}
            />
          </label>
          <Button variant="secondary" type="submit" disabled={busy}>
            Save budget
          </Button>
        </form>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
          gap: 12,
          marginTop: 12,
        }}
      >
        {tiles.map((tile) => (
          <div key={tile.label}>
            <strong style={{ fontSize: "1.4rem", display: "block" }}>{tile.value}</strong>
            <span className="app-muted">{tile.label}</span>
          </div>
        ))}
      </div>
      {summary.bySubsystem.length > 0 ? (
        <p className="app-muted" style={{ marginTop: 12, marginBottom: 0 }}>
          By subsystem:{" "}
          {summary.bySubsystem.map((s) => `${s.subsystem} ${usd(s.totalUsd)}`).join(" · ")}
        </p>
      ) : null}
    </Panel>
  );
}

function AddItemForm({
  busy,
  mutate,
}: {
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const [partName, setPartName] = useState("");
  const [subsystem, setSubsystem] = useState("");
  const [category, setCategory] = useState<BomCategory>("purchased");
  const [quantity, setQuantity] = useState("1");
  const [unitCostUsd, setUnitCostUsd] = useState("");

  return (
    <Panel id="bom-cost-add">
      <h2 style={{ marginTop: 0 }}>Add line item</h2>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!partName.trim()) return;
          mutate({
            action: "add-item",
            partName: partName.trim(),
            subsystem: subsystem.trim() || "Unassigned",
            category,
            quantity: Number(quantity) || 1,
            unitCostUsd: Number(unitCostUsd) || 0,
            source: "manual",
          });
          setPartName("");
          setSubsystem("");
          setCategory("purchased");
          setQuantity("1");
          setUnitCostUsd("");
        }}
      >
        <FormGrid>
          <FormRow label="Part name">
            <input value={partName} onChange={(event) => setPartName(event.target.value)} required />
          </FormRow>
          <FormRow label="Subsystem">
            <input
              value={subsystem}
              placeholder="Unassigned"
              onChange={(event) => setSubsystem(event.target.value)}
            />
          </FormRow>
          <FormRow label="Category">
            <select value={category} onChange={(event) => setCategory(event.target.value as BomCategory)}>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {bomCategoryLabel(c)}
                </option>
              ))}
            </select>
          </FormRow>
          <FormRow label="Quantity">
            <input
              type="number"
              min={1}
              step="1"
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
            />
          </FormRow>
          <FormRow label="Unit cost (USD)">
            <input
              type="number"
              min={0}
              step="0.01"
              value={unitCostUsd}
              onChange={(event) => setUnitCostUsd(event.target.value)}
            />
          </FormRow>
        </FormGrid>
        <div style={{ marginTop: 12 }}>
          <Button variant="primary" type="submit" disabled={busy || !partName.trim()}>
            Add item
          </Button>
        </div>
      </form>
    </Panel>
  );
}

function ItemsTable({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  if (view.items.length === 0) {
    return (
      <EmptyState
        badge="No line items yet"
        badgeTone="setup"
        title="No BOM line items for this season"
        description="Add a purchased part, raw material, or CAD-imported component to start rolling up cost against budget."
      />
    );
  }
  return (
    <Panel>
      <div
        style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12 }}
      >
        <h2 style={{ margin: 0 }}>Line items</h2>
        <ExportButton
          rows={view.items}
          columns={BOM_CSV_COLUMNS}
          feature={`BOM ${view.seasonYear}`}
          orgLabel={view.teamNumber != null ? `team-${view.teamNumber}` : null}
          orgId={view.orgId}
          size="sm"
          provenance={`Season ${view.seasonYear} line items. Costs are raw numbers so the sheet can total them.`}
        />
      </div>
      <div style={{ overflowX: "auto", marginTop: 12 }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th scope="col" style={{ textAlign: "left" }}>Part</th>
              <th scope="col" style={{ textAlign: "left" }}>Subsystem</th>
              <th scope="col" style={{ textAlign: "left" }}>Category</th>
              <th scope="col" style={{ textAlign: "right" }}>Qty</th>
              <th scope="col" style={{ textAlign: "right" }}>Unit</th>
              <th scope="col" style={{ textAlign: "right" }}>Line total</th>
              <th scope="col" style={{ textAlign: "left" }}>Source</th>
              <th scope="col"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {view.items.map((item: BomLineItem) => (
              <tr key={item.id}>
                <td>{item.partName}</td>
                <td>{item.subsystem}</td>
                <td>{bomCategoryLabel(item.category)}</td>
                <td style={{ textAlign: "right" }}>{item.quantity}</td>
                <td style={{ textAlign: "right" }}>{usd(item.unitCostUsd)}</td>
                <td style={{ textAlign: "right" }}>{usd(item.lineTotalUsd)}</td>
                <td>{bomSourceLabel(item.source)}</td>
                <td style={{ textAlign: "right" }}>
                  <Button variant="secondary" type="button" disabled={busy} aria-label={`Remove ${item.partName}`} onClick={() => mutate({ action: "delete-item", itemId: item.id })}>
                    Remove
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
