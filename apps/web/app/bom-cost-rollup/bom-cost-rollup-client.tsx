"use client";

import { useCallback, useEffect, useState } from "react";
import { EmptyState, FormGrid, FormRow, PageHeader, Panel } from "../../components/ui";
import { bomCategoryLabel, bomSourceLabel, bomStatusLabel } from "../../lib/bom-cost-rollup";
import type { BomCostRollupView } from "../../lib/bom-cost-rollup/compute-bom-cost-rollup";
import type { BomCategory, BomLineItem, BomStatus } from "../../lib/bom-cost-rollup/types";

type LiveView = Extract<BomCostRollupView, { status: "live" }>;

const CATEGORIES: BomCategory[] = ["purchased", "raw_material", "fastener", "electronics", "other"];

function usd(value: number): string {
  return value.toLocaleString(undefined, { style: "currency", currency: "USD" });
}

function statusTone(status: BomStatus): string {
  if (status === "over") return "demo";
  if (status === "near") return "setup";
  return "good";
}

export default function BomCostRollupClient() {
  const [view, setView] = useState<BomCostRollupView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  const orgId = view && "orgId" in view ? view.orgId : null;

  const load = useCallback((seasonOverride?: number) => {
    setFetchFailed(false);
    setError("");
    const params = new URLSearchParams(window.location.search);
    const urlOrg = params.get("orgId");
    const seasonQuery = seasonOverride != null ? String(seasonOverride) : params.get("seasonYear");
    const query = new URLSearchParams();
    if (urlOrg) query.set("orgId", urlOrg);
    if (seasonQuery) query.set("seasonYear", seasonQuery);
    void fetch(`/api/bom-cost-rollup${query.toString() ? `?${query.toString()}` : ""}`)
      .then(async (response) => {
        const data = (await response.json()) as BomCostRollupView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setFetchFailed(true);
          return;
        }
        setView(data);
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
      const seasonYear = view?.status === "live" ? view.seasonYear : undefined;
      try {
        const response = await fetch("/api/bom-cost-rollup", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, seasonYear, ...payload }),
        });
        const data = (await response.json()) as BomCostRollupView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setError("error" in data && data.error ? data.error : "Something went wrong.");
          return;
        }
        setView(data);
      } catch {
        setError("Network error — please try again.");
      } finally {
        setBusy(false);
      }
    },
    [orgId, busy, view],
  );

  return (
    <main className="module-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={orgId ? `/build?orgId=${encodeURIComponent(orgId)}` : "/build"}>Build</a>
            {" / BOM cost rollup"}
          </>
        }
        title="BOM cost rollup"
        description="Roll up bill-of-materials line items — logged manually or imported from CAD — against a season budget, broken down by subsystem and category."
      >
        {view?.status === "live" && view.seasons.length > 0 ? (
          <label className="app-muted" style={{ display: "flex", gap: 6, alignItems: "center" }}>
            Season
            <select value={view.seasonYear} onChange={(event) => load(Number(event.target.value))}>
              {view.seasons.map((season) => (
                <option key={season} value={season}>
                  {season}
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
          title="Could not load the BOM cost rollup"
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
          <SummaryTiles view={view} busy={busy} mutate={mutate} />
          <AddItemForm busy={busy} mutate={mutate} />
          <ItemsTable view={view} busy={busy} mutate={mutate} />
        </div>
      )}
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
    { label: "Budget used", value: `${Math.round(summary.percentUsed * 100)}%` },
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
          <button type="submit" className="app-button secondary" disabled={busy}>
            Save budget
          </button>
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
    <Panel>
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
          <button type="submit" className="app-button" disabled={busy || !partName.trim()}>
            Add item
          </button>
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
      <h2 style={{ marginTop: 0 }}>Line items</h2>
      <div style={{ overflowX: "auto" }}>
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
                  <button
                    type="button"
                    className="app-button secondary"
                    disabled={busy}
                    aria-label={`Remove ${item.partName}`}
                    onClick={() => mutate({ action: "delete-item", itemId: item.id })}
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
