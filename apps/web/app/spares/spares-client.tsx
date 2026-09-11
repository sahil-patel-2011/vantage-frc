"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { OfflineBanner } from "../../components/offline-banner";
import { EmptyState, PageHeader, Button } from "../../components/ui";
import { ExportButton, type CsvColumn } from "../../components/ui/export-button";
import { hubHref } from "../../lib/nav/hubs";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../lib/offline/feature-cache";
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

function isSparesView(value: unknown): value is SparesView {
  if (!value || typeof value !== "object") return false;
  const status = (value as { status?: unknown }).status;
  return status === "setup_required" || status === "live";
}

function sparesCacheOrg(data: SparesView, orgHint: string): string {
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

async function persistSparesSnapshot(orgHint: string, data: SparesView): Promise<void> {
  const cacheOrg = sparesCacheOrg(data, orgHint);
  if (!cacheOrg) return;
  try {
    await putFeatureSnapshot("spares", cacheOrg, data);
    if (!orgHint) await putFeatureSnapshot("spares", "_", data);
  } catch {
    // Live Consumables already painted; IndexedDB is best-effort.
  }
}

function SparesRelated({ orgId }: { orgId?: string | null }) {
  return (
    <nav className="product-hub-related" aria-label="Related consumables tools">
      <Button as="a" variant="secondary" href={hubHref("/business", "orders", orgId)}>
        Orders
      </Button>
      <Button as="a" variant="secondary" href={withOrgHref("/packing", orgId)}>
        Packing list
      </Button>
      <Button as="a" variant="secondary" href={hubHref("/build", "spare-forecast", orgId)}>
        Spares forecast
      </Button>
    </nav>
  );
}

function SparesNextActions({ orgId }: { orgId: string }) {
  const actions = [
    {
      id: "add",
      label: "Add a consumable",
      detail: "On-hand counts and reorder points stay blank until you stock the shelf.",
      href: "#spares-add",
      primary: true,
    },
    {
      id: "orders",
      label: "Open Orders",
      detail: "A reorder point that fires becomes a purchase request.",
      href: hubHref("/business", "orders", orgId),
      primary: false,
    },
    {
      id: "packing",
      label: "Open Packing list",
      detail: "Competition load-out is what runs this bin dry.",
      href: withOrgHref("/packing", orgId),
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

export default function SparesClient() {
  const [view, setView] = useState<SparesView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const viewRef = useRef<SparesView | null>(null);
  viewRef.current = view;

  const orgId = view && "orgId" in view ? view.orgId : null;

  const load = useCallback(async () => {
    const params = new URLSearchParams(window.location.search);
    const orgHint = params.get("orgId")?.trim() ?? "";
    let hadCache = Boolean(viewRef.current);
    try {
      const cached = await getFeatureSnapshot<SparesView>("spares", orgHint || "_");
      if (!viewRef.current && cached?.data && isSparesView(cached.data)) {
        setView(cached.data);
        setFromCache(true);
        setCachedAt(cached.cachedAt);
        hadCache = true;
      }
    } catch {
      // IndexedDB missing or blocked; live fetch still runs.
    }
    setFetchFailed(false);
    setError("");
    setErrorStatus(null);
    setErrorMessage(null);
    try {
      const query = new URLSearchParams();
      if (orgHint) query.set("orgId", orgHint);
      const response = await fetch(`/api/spares${query.toString() ? `?${query.toString()}` : ""}`, {
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
        setErrorMessage(
          data && typeof data === "object" && "error" in data && typeof data.error === "string"
            ? data.error
            : null,
        );
        return;
      }
      if (!response.ok || !isSparesView(data)) {
        if (hadCache || viewRef.current) {
          setFromCache(true);
          setError("Could not refresh Consumables. Showing the last copy on this device.");
          setFetchFailed(false);
          return;
        }
        setFetchFailed(true);
        setErrorStatus(response.status);
        setErrorMessage(
          data && typeof data === "object" && "error" in data && typeof data.error === "string"
            ? data.error
            : null,
        );
        return;
      }
      setView(data);
      setFromCache(false);
      setCachedAt(null);
      await persistSparesSnapshot(orgHint, data);
    } catch {
      if (hadCache || viewRef.current) {
        setFromCache(true);
        setError("Could not refresh Consumables. Showing the last copy on this device.");
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
      void fetch("/api/spares", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId, ...payload }),
        signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
      })
        .then(async (response) => {
          const data: unknown = await response.json().catch(() => null);
          if (!response.ok || !isSparesView(data)) {
            setError(
              data && typeof data === "object" && "error" in data && typeof data.error === "string"
                ? data.error
                : "Something went wrong.",
            );
            return;
          }
          setView(data);
          setFromCache(false);
          void persistSparesSnapshot(orgId, data);
        })
        .catch(() => setError("Network error — please try again."))
        .finally(() => setBusy(false));
    },
    [orgId, busy],
  );

  const buildHref = orgId ? `/build?orgId=${encodeURIComponent(orgId)}` : "/build";
  const header = (
    <PageHeader
      breadcrumbs={
        <>
          <a href={buildHref}>Build</a>
          {" / Consumables"}
        </>
      }
      title="Consumables & Spares"
      description="Track shop consumables — fasteners, wire, tape, rivets, PPE — with on-hand counts and reorder points, so you never discover you're out of #10-32s the night before ship."
    >
      <SparesRelated orgId={orgId} />
    </PageHeader>
  );

  if (!view) {
    const copy = fetchFailed
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
        <OfflineBanner feature="Consumables" fromCache={fromCache} cachedAt={cachedAt} />
        <EmptyState
          title={copy ? copy.title : "Loading…"}
          description={copy ? copy.description : "Checking your team."}
          aria-busy={!fetchFailed}
        >
          {copy?.primary ? (
            <Button as="a" variant="primary" href={copy.primary.href}>
              {copy.primary.label}
            </Button>
          ) : null}
          {copy?.showRetry ? (
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
          <OfflineBanner feature="Consumables" fromCache={fromCache} cachedAt={cachedAt} />
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
      break;
    default: {
      view satisfies never;
      return null;
    }
  }

  return (
    <main className="module-page">
      {header}
      <OfflineBanner feature="Consumables" fromCache={fromCache} cachedAt={cachedAt} />
      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}
      <SparesNextActions orgId={view.orgId} />
      <div style={{ display: "grid", gap: 16 }}>
        <SummaryTiles view={view} />
        {view.summary.reorderList.length > 0 ? <ReorderList view={view} /> : null}
        <AddItemForm busy={busy} mutate={mutate} />
        <ItemTable view={view} busy={busy} mutate={mutate} />
      </div>
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
      id="spares-add"
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
        <Button variant="primary" type="submit" disabled={busy || !form.name.trim()}>
          Add consumable
        </Button>
      </div>
    </form>
  );
}

function ItemTable({ view, busy, mutate }: { view: LiveView; busy: boolean; mutate: Mutate }) {
  if (view.items.length === 0) {
    return (
      <EmptyState
        badge="No consumables yet"
        badgeTone="setup"
        title="Stock your shelf"
        description="Add the consumables you burn through so the team knows when to reorder."
      >
        <Button as="a" variant="primary" href="#spares-add">
          Add a consumable
        </Button>
      </EmptyState>
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
          provenance="Live shelf counts for this team — status is recomputed from on-hand vs reorder point."
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
