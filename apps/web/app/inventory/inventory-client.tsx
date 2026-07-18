"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AiInsightPanel } from "../../components/ai-insight-panel";
import {
  bomCoverage,
  categoryLabel,
  INVENTORY_CATEGORIES,
  isLowStock,
  LOCATION_KINDS,
  summarizeInventory,
  TX_REASONS,
  type InventoryItem,
  type InventoryView,
  type TxReason,
} from "../../lib/inventory";
import InventoryLabelTools from "./inventory-label-tools";

type ActionBody = Record<string, unknown> & { action: string; orgId: string };
type ReadyView = Extract<InventoryView, { status: "ready" }>;
type InventoryTab = "stock" | "locations" | "bom";

function fmtQty(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100);
}
function fmtMoney(value: number): string {
  return `$${value.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

// ---------------------------------------------------------------------------
// Stock: one row per item, with quick +/- and an inline adjust + edit panel.
// ---------------------------------------------------------------------------

function ItemRow({
  item,
  locations,
  orgId,
  busyKey,
  run,
}: {
  item: InventoryItem;
  locations: ReadyView["locations"];
  orgId: string;
  busyKey: string | null;
  run: (body: ActionBody, key: string) => Promise<void>;
}) {
  const [mode, setMode] = useState<"none" | "adjust" | "edit">("none");
  const [delta, setDelta] = useState("");
  const [reason, setReason] = useState<TxReason>("used");
  const [note, setNote] = useState("");
  const busy = busyKey === `item:${item.id}`;
  const low = isLowStock(item);

  const adjust = (amount: number, why: TxReason) =>
    run({ action: "adjust_stock", orgId, itemId: item.id, delta: amount, reason: why }, `item:${item.id}`);

  return (
    <li className={low ? "inventory-item low" : "inventory-item"}>
      <div className="inventory-item-main">
        <div className="inventory-item-id">
          <strong>{item.name}</strong>
          <span className="inventory-item-tags">
            <em>{categoryLabel(item.category)}</em>
            {item.locationName ? <em className="loc">{item.locationName}</em> : null}
            {item.subsystem ? <em>{item.subsystem}</em> : null}
            {low ? <em className="low-tag">Low</em> : null}
            {item.archived ? <em className="arch-tag">Archived</em> : null}
          </span>
          {item.partNumber || item.vendor ? (
            <small className="app-muted">
              {[item.partNumber, item.vendor].filter(Boolean).join(" · ")}
            </small>
          ) : null}
        </div>
        <div className="inventory-item-qty">
          <button type="button" aria-label="Decrease" disabled={busy} onClick={() => void adjust(-1, "used")}>
            −
          </button>
          <b>
            {fmtQty(item.quantity)}
            <span>{item.unit}</span>
          </b>
          <button type="button" aria-label="Increase" disabled={busy} onClick={() => void adjust(1, "received")}>
            +
          </button>
        </div>
        <div className="inventory-item-actions">
          <button type="button" className="inventory-link" disabled={busy} onClick={() => setMode(mode === "adjust" ? "none" : "adjust")}>
            Adjust
          </button>
          <button type="button" className="inventory-link" disabled={busy} onClick={() => setMode(mode === "edit" ? "none" : "edit")}>
            Edit
          </button>
        </div>
      </div>

      {mode === "adjust" ? (
        <form
          className="inventory-adjust"
          onSubmit={(event) => {
            event.preventDefault();
            const amount = Number(delta);
            if (!Number.isFinite(amount) || amount === 0) return;
            void adjust(amount, reason).then(() => {
              setDelta("");
              setNote("");
              setMode("none");
            });
            if (note.trim()) {
              void run({ action: "adjust_stock", orgId, itemId: item.id, delta: amount, reason, note: note.trim() }, `item:${item.id}`);
            }
          }}
        >
          <input
            type="number"
            step="any"
            placeholder="± qty"
            value={delta}
            disabled={busy}
            onChange={(event) => setDelta(event.target.value)}
          />
          <select value={reason} disabled={busy} onChange={(event) => setReason(event.target.value as TxReason)}>
            {TX_REASONS.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
          <input placeholder="Note (optional)" value={note} disabled={busy} onChange={(event) => setNote(event.target.value)} />
          <button type="submit" className="app-button secondary sm" disabled={busy || !delta}>
            Apply
          </button>
        </form>
      ) : null}

      {mode === "edit" ? (
        <ItemEditForm item={item} locations={locations} busy={busy} orgId={orgId} run={run} onDone={() => setMode("none")} />
      ) : null}
    </li>
  );
}

function ItemEditForm({
  item,
  locations,
  busy,
  orgId,
  run,
  onDone,
}: {
  item: InventoryItem;
  locations: ReadyView["locations"];
  busy: boolean;
  orgId: string;
  run: (body: ActionBody, key: string) => Promise<void>;
  onDone: () => void;
}) {
  const [minQuantity, setMinQuantity] = useState(String(item.minQuantity));
  const [unitCost, setUnitCost] = useState(item.unitCost == null ? "" : String(item.unitCost));
  const [locationId, setLocationId] = useState(item.locationId ?? "");
  const [subsystem, setSubsystem] = useState(item.subsystem ?? "");

  return (
    <form
      className="inventory-edit"
      onSubmit={(event) => {
        event.preventDefault();
        void run(
          {
            action: "update_item",
            orgId,
            id: item.id,
            minQuantity: minQuantity === "" ? 0 : Number(minQuantity),
            unitCost: unitCost === "" ? null : Number(unitCost),
            locationId: locationId || null,
            subsystem: subsystem.trim() || null,
          },
          `item:${item.id}`,
        ).then(onDone);
      }}
    >
      <label className="inventory-field">
        <span>Reorder at</span>
        <input type="number" step="any" min={0} value={minQuantity} disabled={busy} onChange={(e) => setMinQuantity(e.target.value)} />
      </label>
      <label className="inventory-field">
        <span>Unit cost</span>
        <input type="number" step="any" min={0} placeholder="—" value={unitCost} disabled={busy} onChange={(e) => setUnitCost(e.target.value)} />
      </label>
      <label className="inventory-field">
        <span>Location</span>
        <select value={locationId} disabled={busy} onChange={(e) => setLocationId(e.target.value)}>
          <option value="">Unassigned</option>
          {locations.map((location) => (
            <option key={location.id} value={location.id}>
              {location.name}
            </option>
          ))}
        </select>
      </label>
      <label className="inventory-field">
        <span>Subsystem</span>
        <input value={subsystem} disabled={busy} placeholder="e.g. Drivetrain" onChange={(e) => setSubsystem(e.target.value)} />
      </label>
      <div className="inventory-edit-actions">
        <button type="submit" className="app-button secondary sm" disabled={busy}>
          Save
        </button>
        <button
          type="button"
          className="inventory-link"
          disabled={busy}
          onClick={() => void run({ action: "update_item", orgId, id: item.id, archived: !item.archived }, `item:${item.id}`).then(onDone)}
        >
          {item.archived ? "Unarchive" : "Archive"}
        </button>
        <button
          type="button"
          className="inventory-link danger"
          disabled={busy}
          onClick={() => {
            if (confirm(`Delete "${item.name}" and its stock history?`)) {
              void run({ action: "delete_item", orgId, id: item.id }, `item:${item.id}`);
            }
          }}
        >
          Delete
        </button>
      </div>
    </form>
  );
}

function AddItemForm({
  orgId,
  locations,
  busy,
  onCreate,
  onClose,
}: {
  orgId: string;
  locations: ReadyView["locations"];
  busy: boolean;
  onCreate: (body: ActionBody) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState("other");
  const [unit, setUnit] = useState("each");
  const [initialQuantity, setInitialQuantity] = useState("");
  const [minQuantity, setMinQuantity] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [locationId, setLocationId] = useState("");
  const [subsystem, setSubsystem] = useState("");

  return (
    <form
      className="inventory-new app-card"
      onSubmit={(event) => {
        event.preventDefault();
        if (!name.trim()) return;
        onCreate({
          action: "create_item",
          orgId,
          name: name.trim(),
          category,
          unit: unit.trim() || "each",
          initialQuantity: initialQuantity === "" ? 0 : Number(initialQuantity),
          minQuantity: minQuantity === "" ? 0 : Number(minQuantity),
          unitCost: unitCost === "" ? null : Number(unitCost),
          locationId: locationId || null,
          subsystem: subsystem.trim() || null,
        });
      }}
    >
      <header>
        <h2>Add item</h2>
        <button type="button" className="inventory-link" onClick={onClose}>
          Cancel
        </button>
      </header>
      <div className="inventory-new-grid">
        <label className="inventory-field grow">
          <span>Name</span>
          <input value={name} disabled={busy} placeholder="e.g. NEO Vortex" onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="inventory-field">
          <span>Category</span>
          <select value={category} disabled={busy} onChange={(e) => setCategory(e.target.value)}>
            {INVENTORY_CATEGORIES.map((value) => (
              <option key={value} value={value}>
                {categoryLabel(value)}
              </option>
            ))}
          </select>
        </label>
        <label className="inventory-field">
          <span>Unit</span>
          <input value={unit} disabled={busy} onChange={(e) => setUnit(e.target.value)} />
        </label>
        <label className="inventory-field">
          <span>On hand</span>
          <input type="number" step="any" min={0} placeholder="0" value={initialQuantity} disabled={busy} onChange={(e) => setInitialQuantity(e.target.value)} />
        </label>
        <label className="inventory-field">
          <span>Reorder at</span>
          <input type="number" step="any" min={0} placeholder="0" value={minQuantity} disabled={busy} onChange={(e) => setMinQuantity(e.target.value)} />
        </label>
        <label className="inventory-field">
          <span>Unit cost</span>
          <input type="number" step="any" min={0} placeholder="—" value={unitCost} disabled={busy} onChange={(e) => setUnitCost(e.target.value)} />
        </label>
        <label className="inventory-field">
          <span>Location</span>
          <select value={locationId} disabled={busy} onChange={(e) => setLocationId(e.target.value)}>
            <option value="">Unassigned</option>
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.name}
              </option>
            ))}
          </select>
        </label>
        <label className="inventory-field">
          <span>Subsystem</span>
          <input value={subsystem} disabled={busy} placeholder="e.g. Drivetrain" onChange={(e) => setSubsystem(e.target.value)} />
        </label>
      </div>
      <button type="submit" className="app-button" disabled={busy || !name.trim()}>
        {busy ? "Adding…" : "Add item"}
      </button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Locations & BOM panels
// ---------------------------------------------------------------------------

function LocationsPanel({ view, orgId, busyKey, run }: { view: ReadyView; orgId: string; busyKey: string | null; run: (body: ActionBody, key: string) => Promise<void> }) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState("shelf");
  const busy = busyKey === "location";

  return (
    <div className="inventory-section">
      <ul className="inventory-locations">
        {view.locations.map((location) => (
          <li key={location.id}>
            <div>
              <strong>{location.name}</strong>
              <small className="app-muted">
                {location.kind} · {location.itemCount} item{location.itemCount === 1 ? "" : "s"}
              </small>
            </div>
            <button
              type="button"
              className="inventory-link danger"
              disabled={busyKey === `location:${location.id}`}
              onClick={() => {
                if (confirm(`Delete location "${location.name}"? Items keep their stock but lose this location.`)) {
                  void run({ action: "delete_location", orgId, id: location.id }, `location:${location.id}`);
                }
              }}
            >
              Delete
            </button>
          </li>
        ))}
        {view.locations.length === 0 ? <p className="app-muted">No locations yet — add shelves, bins, or carts.</p> : null}
      </ul>
      <form
        className="inventory-add-row"
        onSubmit={(event) => {
          event.preventDefault();
          if (!name.trim()) return;
          void run({ action: "create_location", orgId, name: name.trim(), kind }, "location").then(() => setName(""));
        }}
      >
        <input placeholder="New location name" value={name} disabled={busy} onChange={(e) => setName(e.target.value)} />
        <select value={kind} disabled={busy} onChange={(e) => setKind(e.target.value)}>
          {LOCATION_KINDS.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
        <button type="submit" className="app-button secondary" disabled={busy || !name.trim()}>
          Add location
        </button>
      </form>
    </div>
  );
}

function BomPanel({ view, orgId, busyKey, run }: { view: ReadyView; orgId: string; busyKey: string | null; run: (body: ActionBody, key: string) => Promise<void> }) {
  const [subsystem, setSubsystem] = useState("");
  const [itemId, setItemId] = useState("");
  const [qty, setQty] = useState("");
  const coverage = useMemo(() => bomCoverage(view.bom, view.items), [view.bom, view.items]);
  const activeItems = view.items.filter((item) => !item.archived);
  const busy = busyKey === "bom";

  return (
    <div className="inventory-section">
      {coverage.map((sub) => (
        <article key={sub.subsystem} className={sub.buildable ? "inventory-bom buildable" : "inventory-bom"}>
          <header>
            <strong>{sub.subsystem}</strong>
            <span className={sub.buildable ? "app-badge good" : "app-badge setup"}>
              {sub.buildable ? "Buildable" : `${sub.shortCount} short`}
            </span>
          </header>
          <ul>
            {sub.lines.map((line) => (
              <li key={line.itemId} className={line.short > 0 ? "short" : undefined}>
                <span>{line.itemName}</span>
                <b>
                  {fmtQty(line.onHand)} / {fmtQty(line.needed)}
                  {line.short > 0 ? <em> short {fmtQty(line.short)}</em> : null}
                </b>
                <button
                  type="button"
                  className="inventory-link danger"
                  aria-label="Remove BOM line"
                  disabled={busy}
                  onClick={() => {
                    const entry = view.bom.find((b) => b.subsystem === sub.subsystem && b.itemId === line.itemId);
                    if (entry) void run({ action: "delete_bom", orgId, id: entry.id }, "bom");
                  }}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        </article>
      ))}
      {coverage.length === 0 ? (
        <p className="app-muted">No BOM lines yet. Map each subsystem to the parts it needs to check buildability.</p>
      ) : null}
      <form
        className="inventory-bom-add"
        onSubmit={(event) => {
          event.preventDefault();
          const needed = Number(qty);
          if (!subsystem.trim() || !itemId || !Number.isFinite(needed) || needed <= 0) return;
          void run({ action: "set_bom", orgId, subsystem: subsystem.trim(), itemId, quantityNeeded: needed }, "bom").then(() => setQty(""));
        }}
      >
        <input placeholder="Subsystem (e.g. Arm)" value={subsystem} disabled={busy} onChange={(e) => setSubsystem(e.target.value)} />
        <select value={itemId} disabled={busy} onChange={(e) => setItemId(e.target.value)}>
          <option value="">Select part…</option>
          {activeItems.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
        <input type="number" step="any" min={0} placeholder="Qty needed" value={qty} disabled={busy} onChange={(e) => setQty(e.target.value)} />
        <button type="submit" className="app-button secondary" disabled={busy || !subsystem.trim() || !itemId || !qty}>
          Add to BOM
        </button>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Root
// ---------------------------------------------------------------------------

export default function InventoryClient() {
  const [view, setView] = useState<InventoryView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [tab, setTab] = useState<InventoryTab>("stock");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [lowOnly, setLowOnly] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [showLabels, setShowLabels] = useState(false);

  const load = useCallback(async () => {
    setFetchFailed(false);
    const params = new URLSearchParams(window.location.search);
    const orgId = params.get("orgId");
    try {
      const response = await fetch(`/api/inventory${orgId ? `?orgId=${encodeURIComponent(orgId)}` : ""}`);
      const data = (await response.json()) as InventoryView | { error?: string };
      if (!response.ok || !("status" in data)) {
        setError("error" in data && data.error ? data.error : "Could not load inventory.");
        setFetchFailed(true);
        return;
      }
      setError("");
      setView(data);
    } catch {
      setFetchFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const run = useCallback(
    async (body: ActionBody, key: string) => {
      setBusyKey(key);
      setError("");
      try {
        const response = await fetch("/api/inventory", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = (await response.json()) as { error?: string };
        if (!response.ok) {
          setError(data.error ?? "Action failed.");
          return;
        }
        if (body.action === "create_item") setShowAdd(false);
        await load();
      } catch {
        setError("Network error — changes were not saved.");
      } finally {
        setBusyKey(null);
      }
    },
    [load],
  );

  if (fetchFailed) {
    return (
      <main className="module-page inventory-page">
        <header className="app-page-header">
          <div>
            <span className="breadcrumbs">Build / Inventory</span>
            <h1>Inventory &amp; BOM</h1>
          </div>
        </header>
        <div className="app-card inventory-empty">
          <strong>Could not load inventory</strong>
          <p className="app-muted">{error || "Check your connection and try again."}</p>
          <button type="button" className="app-button secondary" onClick={() => void load()}>
            Retry
          </button>
        </div>
      </main>
    );
  }

  if (!view) {
    return (
      <main className="module-page inventory-page">
        <header className="app-page-header">
          <div>
            <span className="breadcrumbs">Build / Inventory</span>
            <h1>Inventory &amp; BOM</h1>
          </div>
        </header>
        <div className="app-card inventory-empty">
          <p className="app-muted">Loading inventory…</p>
        </div>
      </main>
    );
  }

  if (view.status === "setup_required") {
    return (
      <main className="module-page inventory-page">
        <header className="app-page-header">
          <div>
            <span className="breadcrumbs">Build / Inventory</span>
            <h1>Inventory &amp; BOM</h1>
            <p>Track parts and materials, where they live, and what each mechanism needs.</p>
          </div>
        </header>
        <div className="app-card inventory-empty">
          <strong>Select a team workspace</strong>
          <p className="app-muted">{view.message}</p>
          <a className="app-button" href="/workspace">
            Choose workspace
          </a>
        </div>
      </main>
    );
  }

  const { context, items, locations } = view;
  const orgId = context.orgId ?? "";
  const summary = summarizeInventory(items);
  const query = search.trim().toLowerCase();
  const visibleItems = items.filter((item) => {
    if (!showArchived && item.archived) return false;
    if (lowOnly && !isLowStock(item)) return false;
    if (category !== "all" && item.category !== category) return false;
    if (query) {
      const hay = `${item.name} ${item.partNumber ?? ""} ${item.vendor ?? ""} ${item.subsystem ?? ""} ${item.locationName ?? ""}`.toLowerCase();
      if (!hay.includes(query)) return false;
    }
    return true;
  });

  return (
    <main className="module-page inventory-page">
      <header className="app-page-header">
        <div>
          <span className="breadcrumbs">Build / Inventory</span>
          <h1>Inventory &amp; BOM</h1>
          <p>
            Parts &amp; materials stock, storage locations, and per-mechanism bills of materials for{" "}
            {context.orgName ?? "your team"}
            {context.teamNumber ? ` (Team ${context.teamNumber})` : ""}.
          </p>
        </div>
        <div className="inventory-header-actions">
          {summary.lowStock > 0 ? <span className="app-badge setup">{summary.lowStock} low</span> : null}
          <button type="button" className="app-button" onClick={() => setShowAdd((value) => !value)}>
            {showAdd ? "Close" : "Add item"}
          </button>
          <button type="button" className="app-button secondary" onClick={() => setShowLabels((value) => !value)}>
            Scan / labels
          </button>
        </div>
      </header>

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      <div className="inventory-summary">
        <div className="inventory-summary-tile">
          <strong>{summary.totalItems}</strong>
          <span>tracked items</span>
        </div>
        <div className={summary.lowStock > 0 ? "inventory-summary-tile warn" : "inventory-summary-tile"}>
          <strong>{summary.lowStock}</strong>
          <span>at / below reorder</span>
        </div>
        <div className={summary.outOfStock > 0 ? "inventory-summary-tile warn" : "inventory-summary-tile"}>
          <strong>{summary.outOfStock}</strong>
          <span>out of stock</span>
        </div>
        <div className="inventory-summary-tile">
          <strong>{summary.value > 0 ? fmtMoney(summary.value) : "—"}</strong>
          <span>on-hand value</span>
        </div>
      </div>

      {showAdd ? (
        <AddItemForm
          orgId={orgId}
          locations={locations}
          busy={busyKey === "create-item"}
          onCreate={(body) => void run(body, "create-item")}
          onClose={() => setShowAdd(false)}
        />
      ) : null}

      {showLabels ? (
        <InventoryLabelTools
          orgId={orgId}
          locations={locations}
          onClose={() => setShowLabels(false)}
          onLocate={(location) => {
            setSearch(location.name);
            setCategory("all");
            setLowOnly(false);
            setShowArchived(false);
            setTab("stock");
          }}
        />
      ) : null}

      <nav className="inventory-tabs" aria-label="Inventory sections">
        <button type="button" className={tab === "stock" ? "active" : undefined} onClick={() => setTab("stock")}>
          Stock <b>{summary.totalItems}</b>
        </button>
        <button type="button" className={tab === "locations" ? "active" : undefined} onClick={() => setTab("locations")}>
          Locations <b>{locations.length}</b>
        </button>
        <button type="button" className={tab === "bom" ? "active" : undefined} onClick={() => setTab("bom")}>
          BOM <b>{new Set(view.bom.map((b) => b.subsystem)).size}</b>
        </button>
      </nav>

      {tab === "stock" ? (
        <div className="inventory-section">
          <div className="inventory-toolbar">
            <input
              className="inventory-search"
              placeholder="Search name, part #, vendor, subsystem…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <select value={category} onChange={(event) => setCategory(event.target.value)}>
              <option value="all">All categories</option>
              {INVENTORY_CATEGORIES.map((value) => (
                <option key={value} value={value}>
                  {categoryLabel(value)}
                </option>
              ))}
            </select>
            <label className="inventory-check">
              <input type="checkbox" checked={lowOnly} onChange={(event) => setLowOnly(event.target.checked)} />
              <span>Low only</span>
            </label>
            <label className="inventory-check">
              <input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} />
              <span>Show archived</span>
            </label>
          </div>
          {items.length === 0 ? (
            <div className="app-card inventory-empty">
              <strong>No items yet</strong>
              <p className="app-muted">Add motors, gearboxes, electronics, raw stock, and spares to start tracking stock.</p>
              <button type="button" className="app-button" onClick={() => setShowAdd(true)}>
                Add your first item
              </button>
            </div>
          ) : (
            <ul className="inventory-items">
              {visibleItems.map((item) => (
                <ItemRow key={item.id} item={item} locations={locations} orgId={orgId} busyKey={busyKey} run={run} />
              ))}
              {visibleItems.length === 0 ? <p className="app-muted inventory-list-empty">No items match these filters.</p> : null}
            </ul>
          )}
        </div>
      ) : null}

      {tab === "locations" ? <LocationsPanel view={view} orgId={orgId} busyKey={busyKey} run={run} /> : null}
      {tab === "bom" ? <BomPanel view={view} orgId={orgId} busyKey={busyKey} run={run} /> : null}

      <AiInsightPanel
        orgId={orgId}
        kind="stock_advisor"
        title="Stock advisor"
        description="Reorder brief from low-stock thresholds and BOM shortfalls — what to buy before build hours are lost."
      />
    </main>
  );
}
