"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ExportButton, type CsvColumn } from "../../components/ui/export-button";
import { withOrgHref } from "../../lib/nav/product-nav";
import { consumableCategoryLabel, evaluateConsumable, statusLabel } from "../../lib/spares";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";
import { CONSUMABLE_CATEGORIES, type SparesView } from "../../lib/spares/compute-spares";
import type { Consumable, ConsumableCategory, ConsumableStatus } from "../../lib/spares/types";

type LiveView = Extract<SparesView, { status: "live" }>;
type Mutate = (payload: Record<string, unknown>) => void;

const STATUS_COLOR: Record<ConsumableStatus, string> = { ok: "#1f7a3d", low: "#b26a00", out: "#c02626" };

/**
 * CSV shape of the consumables shelf — the file a mentor sorts by status and takes
 * to McMaster or the hardware store. Counts stay raw numbers so the sheet can add them up.
 */
const CONSUMABLE_CSV_COLUMNS: CsvColumn<Consumable>[] = [
  { key: "name", header: "Item", hint: "Consumable name" },
  { key: "category", header: "Category", value: (item) => consumableCategoryLabel(item.category) },
  { key: "onHand", header: "On hand", hint: "Current count", value: (item) => item.onHand },
  { key: "unit", header: "Unit", hint: "each / ft / roll …" },
  { key: "reorderPoint", header: "Reorder at", hint: "0 means only when out", value: (item) => item.reorderPoint },
  { key: "status", header: "Status", hint: "ok / low / out", value: (item) => evaluateConsumable(item).status },
  {
    key: "needsReorder",
    header: "Needs reorder",
    hint: "true when it is at or below the reorder point",
    value: (item) => evaluateConsumable(item).needsReorder,
  },
  {
    key: "isSpare",
    header: "Held as a spare",
    hint: "true when this bin is stocked as a replacement, not day-to-day shop stock",
    value: (item) => item.isSpare,
  },
  { key: "preferredVendor", header: "Preferred vendor", value: (item) => item.preferredVendor },
  { key: "notes", header: "Notes", value: (item) => item.notes },
];

export default function SparesClient() {
  const [view, setView] = useState<SparesView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  // Kept so an expired session offers sign-in instead of a Retry that cannot work.
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const orgId = view && "orgId" in view ? view.orgId : null;

  const load = useCallback(() => {
    setFetchFailed(false);
    setErrorStatus(null);
    setErrorMessage(null);
    setError("");
    const params = new URLSearchParams(window.location.search);
    const urlOrg = params.get("orgId");
    void fetch(`/api/spares${urlOrg ? `?orgId=${encodeURIComponent(urlOrg)}` : ""}`)
      .then(async (response) => {
        const data = (await response.json()) as SparesView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setErrorStatus(response.status);
          setErrorMessage("error" in data && data.error ? data.error : null);
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

  const mutate = useCallback<Mutate>(
    (payload) => {
      if (!orgId || busy) return;
      setBusy(true);
      setError("");
      void fetch("/api/spares", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId, ...payload }),
      })
        .then(async (response) => {
          const data = (await response.json()) as SparesView | { error?: string };
          if (!response.ok || !("status" in data)) {
            setError("error" in data && data.error ? data.error : "Something went wrong.");
            return;
          }
          setView(data);
        })
        .catch(() => setError("Network error — please try again."))
        .finally(() => setBusy(false));
    },
    [orgId, busy],
  );

  return (
    <main className="module-page">
      <header className="app-page-header">
        <div>
          <span className="breadcrumbs">Build / Consumables</span>
          <h1>Consumables &amp; Spares</h1>
          <p>
            Track shop consumables — fasteners, wire, tape, rivets, PPE — with on-hand counts and reorder points, so you
            never discover you&apos;re out of #10-32s the night before ship.
          </p>
          {/* A reorder point that fires has exactly two destinations: a purchase
              request, and the competition load-out that will run this bin dry.
              Neither was reachable from here. */}
          <nav className="product-hub-related" aria-label="Related consumables tools">
            <a className="app-button secondary" href={withOrgHref("/orders", orgId)}>
              Orders
            </a>
            <a className="app-button secondary" href={withOrgHref("/packing", orgId)}>
              Packing list
            </a>
          </nav>
        </div>
      </header>

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
            <section className="app-card soft-panel">
              <h2>{copy.title}</h2>
              <p className="app-muted">{copy.description}</p>
              {copy.primary ? (
                <a className="app-button" href={copy.primary.href}>
                  {copy.primary.label}
                </a>
              ) : null}
              {copy.showRetry ? (
                <button type="button" className="app-button secondary" onClick={load}>
                  Retry
                </button>
              ) : null}
            </section>
          );
        })()
      ) : view == null ? (
        <section className="app-card soft-panel">
          <h2>Loading…</h2>
          <p className="app-muted">Checking your workspace.</p>
        </section>
      ) : view.status === "setup_required" ? (
        <section className="app-card soft-panel">
          <span className="app-badge setup">Setup required</span>
          <h2>{view.message}</h2>
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
        </section>
      ) : (
        <div style={{ display: "grid", gap: 16 }}>
          <SummaryTiles view={view} />
          {view.summary.reorderList.length > 0 ? <ReorderList view={view} /> : null}
          <AddItemForm busy={busy} mutate={mutate} />
          <ItemTable view={view} busy={busy} mutate={mutate} />
        </div>
      )}
    </main>
  );
}

function SummaryTiles({ view }: { view: LiveView }) {
  const s = view.summary;
  const tiles = [
    { label: "Items", value: String(s.total), color: "inherit" },
    { label: "OK", value: String(s.ok), color: STATUS_COLOR.ok },
    { label: "Low", value: String(s.low), color: STATUS_COLOR.low },
    { label: "Out", value: String(s.out), color: STATUS_COLOR.out },
  ];
  return (
    <section className="app-card soft-panel">
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(96px, 1fr))", gap: 12 }}>
        {tiles.map((tile) => (
          <div key={tile.label}>
            <strong style={{ fontSize: "1.6rem", display: "block", color: tile.color }}>{tile.value}</strong>
            <span className="app-muted">{tile.label}</span>
          </div>
        ))}
      </div>
      {s.byCategory.length > 0 ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
          {s.byCategory.map((row) => (
            <span key={row.category} className={`app-badge ${row.needsReorder > 0 ? "setup" : "demo"}`}>
              {consumableCategoryLabel(row.category)}: {row.total}
              {row.needsReorder > 0 ? ` · ${row.needsReorder} to reorder` : ""}
            </span>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function ReorderList({ view }: { view: LiveView }) {
  return (
    <section className="app-card soft-panel" style={{ borderLeft: "3px solid #c02626" }}>
      <h2 style={{ marginTop: 0 }}>Reorder now ({view.summary.reorderList.length})</h2>
      <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 6 }}>
        {view.summary.reorderList.map((evaluation) => (
          <li key={evaluation.item.id}>
            <strong>{evaluation.item.name}</strong>
            <span style={{ color: STATUS_COLOR[evaluation.status] }}> · {statusLabel(evaluation.status)}</span>
            <small className="app-muted">
              {" "}
              · {evaluation.item.onHand} / reorder at {evaluation.item.reorderPoint} {evaluation.item.unit}
              {evaluation.item.preferredVendor ? ` · ${evaluation.item.preferredVendor}` : ""}
            </small>
          </li>
        ))}
      </ul>
    </section>
  );
}

function AddItemForm({ busy, mutate }: { busy: boolean; mutate: Mutate }) {
  const empty = useMemo(
    () => ({ name: "", category: "fasteners" as ConsumableCategory, unit: "each", onHand: "", reorderPoint: "", preferredVendor: "" }),
    [],
  );
  const [form, setForm] = useState(empty);
  // Kept out of `form` because it is a boolean and `set` writes strings.
  const [isSpare, setIsSpare] = useState(false);
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }));

  return (
    <form
      className="app-card soft-panel"
      onSubmit={(event) => {
        event.preventDefault();
        if (!form.name.trim()) return;
        mutate({
          action: "create-item",
          name: form.name,
          category: form.category,
          unit: form.unit || undefined,
          onHand: form.onHand || undefined,
          reorderPoint: form.reorderPoint || undefined,
          preferredVendor: form.preferredVendor || undefined,
          isSpare,
        });
        setForm(empty);
        setIsSpare(false);
      }}
      style={{ display: "grid", gap: 10 }}
    >
      <h2 style={{ margin: 0 }}>Add consumable</h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 10 }}>
        <label style={{ display: "grid", gap: 4, gridColumn: "1 / -1" }}>
          <span className="app-muted">Item</span>
          <input value={form.name} onChange={set("name")} placeholder="#10-32 x 0.5in socket cap" required />
        </label>
        <label style={{ display: "grid", gap: 4 }}>
          <span className="app-muted">Category</span>
          <select value={form.category} onChange={set("category")}>
            {CONSUMABLE_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {consumableCategoryLabel(category)}
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: "grid", gap: 4 }}>
          <span className="app-muted">Unit</span>
          <input value={form.unit} onChange={set("unit")} placeholder="each" />
        </label>
        <label style={{ display: "grid", gap: 4 }}>
          <span className="app-muted">On hand</span>
          <input type="number" min={0} value={form.onHand} onChange={set("onHand")} />
        </label>
        <label style={{ display: "grid", gap: 4 }}>
          <span className="app-muted">Reorder at</span>
          <input type="number" min={0} value={form.reorderPoint} onChange={set("reorderPoint")} />
        </label>
        <label style={{ display: "grid", gap: 4 }}>
          <span className="app-muted">Preferred vendor</span>
          <input value={form.preferredVendor} onChange={set("preferredVendor")} />
        </label>
        {/* Migration 0520 put "held as a spare" on its own column so it can
            cross category and kind. Spare Forecast counts these rows, and
            nothing in the product could set the column until now. */}
        <label style={{ display: "flex", alignItems: "center", gap: 8, gridColumn: "1 / -1" }}>
          <input type="checkbox" checked={isSpare} onChange={(event) => setIsSpare(event.target.checked)} />
          <span className="app-muted">Held as a spare — a replacement bin, not day-to-day shop stock</span>
        </label>
      </div>
      <div>
        <button type="submit" className="app-button" disabled={busy || !form.name.trim()}>
          Add consumable
        </button>
      </div>
    </form>
  );
}

function ItemTable({ view, busy, mutate }: { view: LiveView; busy: boolean; mutate: Mutate }) {
  if (view.items.length === 0) {
    return (
      <section className="app-card soft-panel">
        <span className="app-badge setup">No consumables yet</span>
        <h2>Stock your shelf</h2>
        <p className="app-muted">Add the consumables you burn through so the team knows when to reorder.</p>
      </section>
    );
  }
  return (
    <section className="app-card soft-panel" style={{ overflowX: "auto" }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <h2 style={{ margin: 0 }}>On hand</h2>
        <ExportButton
          rows={view.items}
          columns={CONSUMABLE_CSV_COLUMNS}
          feature="Consumables"
          orgLabel={view.teamNumber != null ? `team-${view.teamNumber}` : null}
          orgId={view.orgId}
          size="sm"
          provenance="Live shelf counts for this workspace — status is recomputed from on-hand vs reorder point."
        />
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 620, marginTop: 12 }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "1px solid rgba(128,128,128,0.3)" }}>
            <th style={{ padding: "6px 8px" }}>Item</th>
            <th style={{ padding: "6px 8px" }}>Category</th>
            <th style={{ padding: "6px 8px", textAlign: "center" }}>On hand</th>
            <th style={{ padding: "6px 8px", textAlign: "right" }}>Reorder at</th>
            <th style={{ padding: "6px 8px" }}>Status</th>
            <th style={{ padding: "6px 8px", textAlign: "center" }}>Spare</th>
            <th style={{ padding: "6px 8px" }} aria-label="actions" />
          </tr>
        </thead>
        <tbody>
          {view.items.map((item: Consumable) => {
            const status = evaluateConsumable(item).status;
            return (
              <tr key={item.id} style={{ borderBottom: "1px solid rgba(128,128,128,0.15)" }}>
                <td style={{ padding: "6px 8px" }}>
                  <strong>{item.name}</strong>
                  {item.preferredVendor ? <small className="app-muted" style={{ display: "block" }}>{item.preferredVendor}</small> : null}
                </td>
                <td style={{ padding: "6px 8px" }}>{consumableCategoryLabel(item.category)}</td>
                <td style={{ padding: "6px 8px", textAlign: "center", whiteSpace: "nowrap" }}>
                  <button type="button" className="text-button" disabled={busy} aria-label="Decrease" onClick={() => mutate({ action: "adjust-stock", itemId: item.id, delta: -1 })}>
                    −
                  </button>
                  <strong style={{ margin: "0 6px" }}>{item.onHand}</strong>
                  <button type="button" className="text-button" disabled={busy} aria-label="Increase" onClick={() => mutate({ action: "adjust-stock", itemId: item.id, delta: 1 })}>
                    +
                  </button>
                  <small className="app-muted"> {item.unit}</small>
                </td>
                <td style={{ padding: "6px 8px", textAlign: "right" }}>{item.reorderPoint || "—"}</td>
                <td style={{ padding: "6px 8px" }}>
                  <span className="app-badge" style={{ background: STATUS_COLOR[status], color: "#fff" }}>
                    {statusLabel(status)}
                  </span>
                </td>
                <td style={{ padding: "6px 8px", textAlign: "center" }}>
                  <input
                    type="checkbox"
                    checked={item.isSpare}
                    disabled={busy}
                    aria-label={`${item.name} is held as a spare`}
                    onChange={(event) =>
                      mutate({ action: "update-item", itemId: item.id, isSpare: event.target.checked })
                    }
                  />
                </td>
                <td style={{ padding: "6px 8px", textAlign: "right" }}>
                  <button
                    type="button"
                    className="text-button"
                    disabled={busy}
                    onClick={() => {
                      if (window.confirm(`Delete "${item.name}"?`)) mutate({ action: "delete-item", itemId: item.id });
                    }}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
