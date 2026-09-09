"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { AiInsightPanel } from "../../components/ai-insight-panel";
import { Button, EmptyState, PageHeader, Panel } from "../../components/ui";
import { ActionMenu, type ActionSpec } from "../../components/ui/action-menu";
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
import {
  INVENTORY_RELATED_INCLUDE,
  classifyInventoryShell,
  formatInventoryMetric,
  formatInventoryMoney,
  inventoryNextActions,
  inventoryRelatedLinks,
  inventorySetupSteps,
  inventoryShellCopy,
  shouldShowInventorySummaryTiles,
  type InventoryNextAction,
  type InventoryShellKind,
} from "../../lib/inventory/inventory-related";
import { hubHref } from "../../lib/nav/hubs";
import { withOrgHref } from "../../lib/nav/product-nav";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";
import InventoryLabelTools from "./inventory-label-tools";

type ActionBody = Record<string, unknown> & { action: string; orgId: string };
type ReadyView = Extract<InventoryView, { status: "ready" }>;
type InventoryTab = "stock" | "locations" | "bom";

function fmtQty(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100);
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
            {/* Migration 0520 made "held as a spare" its own fact, orthogonal to
                category — Spare Forecast counts these rows, so the list has to
                show which ones they are. */}
            {item.isSpare ? <em>Spare</em> : null}
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
          {/* Button's icon variant only grows the *hit area* on coarse pointers
              (min-width/height, via a media query) — `.inventory-item-qty button`
              still wins the visual 30px box, padding, and colors on a mouse. */}
          <Button variant="icon" aria-label="Decrease" disabled={busy} onClick={() => void adjust(-1, "used")}>
            −
          </Button>
          <b>
            {fmtQty(item.quantity)}
            <span>{item.unit}</span>
          </b>
          <Button variant="icon" aria-label="Increase" disabled={busy} onClick={() => void adjust(1, "received")}>
            +
          </Button>
        </div>
        <div className="inventory-item-actions">
          {/* One row of controls per item: Adjust + Edit stay one tap; archive/delete live
              behind the single overflow menu with a required confirm step. */}
          <ActionMenu
            tone="row"
            label={`${item.name} actions`}
            maxSecondary={1}
            triggerTestId={`inventory-item-more:${item.id}`}
            actions={[
              {
                id: "adjust",
                label: "Adjust",
                intent: "primary",
                disabled: busy,
                hint: "Log a stock change with a reason",
                onClick: () => setMode(mode === "adjust" ? "none" : "adjust"),
              },
              {
                id: "edit",
                label: "Edit",
                disabled: busy,
                hint: "Reorder point, unit cost, location, subsystem",
                onClick: () => setMode(mode === "edit" ? "none" : "edit"),
              },
              {
                id: "archive",
                label: item.archived ? "Unarchive item" : "Archive item",
                disabled: busy,
                hint: item.archived ? "Show it in the active stock list again" : "Hide it without losing stock history",
                onClick: () => {
                  void run({ action: "update_item", orgId, id: item.id, archived: !item.archived }, `item:${item.id}`);
                  setMode("none");
                },
              },
              {
                id: "delete",
                label: "Delete item",
                intent: "destructive",
                disabled: busy,
                hint: "Removes the item and its stock history",
                onClick: () => void run({ action: "delete_item", orgId, id: item.id }, `item:${item.id}`),
              },
            ]}
          />
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
  const [isSpare, setIsSpare] = useState(Boolean(item.isSpare));

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
            isSpare,
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
      <label className="inventory-check">
        <input type="checkbox" checked={isSpare} disabled={busy} onChange={(e) => setIsSpare(e.target.checked)} />
        <span>Held as a spare</span>
      </label>
      {/* Archive + Delete moved into this item's overflow menu (see ItemRow) so the edit
          form has exactly one action: save what you just typed. */}
      <div className="inventory-edit-actions">
        <button type="submit" className="app-button secondary sm" disabled={busy}>
          Save
        </button>
        <button type="button" className="inventory-link" disabled={busy} onClick={onDone}>
          Cancel
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
  const [isSpare, setIsSpare] = useState(false);

  return (
    <form
      id="inventory-add-item"
      className="inventory-new app-card soft-panel"
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
          isSpare,
        });
      }}
    >
      <header>
        <h2>Add item</h2>
        <button type="button" className="inventory-link" onClick={onClose}>
          Cancel
        </button>
      </header>
      <p className="app-muted" style={{ margin: 0 }}>
        Quantities and costs come from real parts — never DEMO stock rows. Adding a common COTS part?{" "}
        <a href={`/parts-catalog?orgId=${encodeURIComponent(orgId)}`}>Pick it from the parts catalog</a> and the name,
        vendor, part number and unit come filled in.
      </p>
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
        {/* The spare flag crosses category and kind (0520): a spare gearbox is
            still category 'gearbox'. Without this checkbox nothing in the
            product could ever write the column Spare Forecast reads. */}
        <label className="inventory-check">
          <input type="checkbox" checked={isSpare} disabled={busy} onChange={(e) => setIsSpare(e.target.checked)} />
          <span>Held as a spare</span>
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
// Soft-UI shells + root
// ---------------------------------------------------------------------------

/**
 * Vendors, Orders and Spare Forecast are the header strip AND the Next actions
 * list. On the shells (loading, setup, error) both render, so every one of the
 * three had two buttons on screen — the lower one carrying the reason, the
 * upper one carrying nothing. `skip` hands this strip the set the panel below
 * is already offering.
 */
function InventoryRelatedStrip({ orgId, skip }: { orgId?: string | null; skip?: Set<string> }) {
  const links = inventoryRelatedLinks(orgId, {
    include: [...INVENTORY_RELATED_INCLUDE],
  }).filter((link) => !skip?.has(link.href));
  if (!links.length) return null;
  return (
    <nav className="product-hub-related inventory-related" aria-label="Related inventory tools">
      {links.map((link) => (
        <a key={link.id} className="app-button secondary" href={link.href}>
          {link.label}
        </a>
      ))}
    </nav>
  );
}

function InventoryNextActionsPanel({ actions }: { actions: InventoryNextAction[] }) {
  if (!actions.length) return null;
  return (
    <section className="app-card soft-panel edc-next-actions inventory-next-actions" aria-label="Next actions">
      <header>
        <h2>Next actions</h2>
        <p className="app-muted">Vendors, Orders, and Spare Forecast — never DEMO stock metrics.</p>
      </header>
      <ol>
        {actions.map((action) => (
          <li key={action.id} className={action.primary ? "primary" : undefined}>
            <div>
              <strong>{action.label}</strong>
              <span>{action.detail}</span>
            </div>
            <a className="app-button secondary" href={action.href}>
              Open
            </a>
          </li>
        ))}
      </ol>
    </section>
  );
}

function InventoryShell({
  description,
  orgId,
  shell,
  error,
  errorStatus,
  onRetry,
  children,
}: {
  description: string;
  orgId?: string | null;
  shell: InventoryShellKind;
  error?: string;
  errorStatus?: number | null;
  onRetry?: () => void;
  children?: ReactNode;
}) {
  const actions = inventoryNextActions({ orgId, shell });
  const copy = inventoryShellCopy(shell);
  // A signed-out tablet needs "Sign in again", not a Retry that can never succeed.
  const failure =
    shell === "error"
      ? loadFailureCopy(
          classifyLoadFailure({
            status: errorStatus,
            message: error,
            online: typeof navigator === "undefined" ? true : navigator.onLine,
          }),
          {
            nextPath:
              typeof window === "undefined"
                ? null
                : `${window.location.pathname}${window.location.search}`,
            message: error,
          },
        )
      : null;
  const buildHref = withOrgHref("/build", orgId);
  const vendorsHref = withOrgHref("/vendors", orgId);
  const ordersHref = hubHref("/business", "orders", orgId);
  const spareForecastHref = hubHref("/build", "spare-forecast", orgId);

  return (
    <main className="module-page inventory-page soft-gate">
      <PageHeader
        breadcrumbs={
          <>
            <a href={buildHref}>Build</a>
            {" / Inventory"}
          </>
        }
        title="Inventory & BOM"
        description={description}
      >
        <InventoryRelatedStrip orgId={orgId} skip={new Set(actions.map((action) => action.href))} />
      </PageHeader>
      {children}
      <EmptyState
        soft
        badge={
          shell === "setup"
            ? "Setup required"
            : shell === "error"
              ? "Unavailable"
              : shell === "empty"
                ? "No parts yet"
                : copy.badge
        }
        badgeTone="setup"
        title={failure ? failure.title : copy.title}
        description={failure ? failure.description : error ?? copy.description}
        aria-busy={shell === "loading"}
      >
        {failure?.primary ? (
          <a className="app-button" href={failure.primary.href}>
            {failure.primary.label}
          </a>
        ) : null}
        {shell === "error" && onRetry && (failure?.showRetry ?? true) ? (
          <button type="button" className="app-button secondary" onClick={onRetry}>
            Retry
          </button>
        ) : null}
        {shell === "setup" ? (
          <a className="app-button" href={orgId ? withOrgHref("/workspace", orgId) : "/workspace"}>
            Open Workspace
          </a>
        ) : null}
        {shell === "empty"
          ? [
              { href: vendorsHref, label: "Open Vendors" },
              { href: ordersHref, label: "Open Orders" },
              { href: spareForecastHref, label: "Open Spare Forecast" },
            ]
              .filter((button) => !actions.some((action) => action.href === button.href))
              .map((button, index) => (
                <a key={button.href} className={index === 0 ? "app-button" : "app-button secondary"} href={button.href}>
                  {button.label}
                </a>
              ))
          : null}
      </EmptyState>
      <InventoryNextActionsPanel actions={actions} />
    </main>
  );
}

function SummaryTiles({
  totalItems,
  lowStock,
  outOfStock,
  value,
}: {
  totalItems: number;
  lowStock: number;
  outOfStock: number;
  value: number;
}) {
  const tiles = [
    { label: "Tracked items", value: formatInventoryMetric(totalItems, true) },
    { label: "At / below reorder", value: formatInventoryMetric(lowStock, true), warn: lowStock > 0 },
    { label: "Out of stock", value: formatInventoryMetric(outOfStock, true), warn: outOfStock > 0 },
    { label: "On-hand value", value: formatInventoryMoney(value, true) },
  ];
  return (
    <section className="inventory-stats" aria-label="Real inventory counts">
      {tiles.map((tile) => (
        <div key={tile.label} className={tile.warn ? "warn" : undefined}>
          <strong>{tile.value}</strong>
          <span className="app-muted" style={{ display: "block" }}>
            {tile.label}
          </span>
        </div>
      ))}
    </section>
  );
}

export default function InventoryClient() {
  const [view, setView] = useState<InventoryView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  // Kept so an expired session offers sign-in instead of a Retry that cannot work.
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [tab, setTab] = useState<InventoryTab>("stock");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [lowOnly, setLowOnly] = useState(false);
  const [sparesOnly, setSparesOnly] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [showLabels, setShowLabels] = useState(false);

  const load = useCallback(async () => {
    setFetchFailed(false);
    setErrorStatus(null);
    setError("");
    const params = new URLSearchParams(window.location.search);
    const orgId = params.get("orgId");
    try {
      const response = await fetch(`/api/inventory${orgId ? `?orgId=${encodeURIComponent(orgId)}` : ""}`);
      const data = (await response.json()) as InventoryView | { error?: string };
      if (!response.ok || !("status" in data)) {
        setError("error" in data && data.error ? data.error : "Could not load inventory.");
        setErrorStatus(response.status);
        setFetchFailed(true);
        return;
      }
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

  const orgId =
    view?.status === "ready"
      ? view.context.orgId
      : view?.status === "setup_required"
        ? view.context.orgId
        : null;
  const itemCount =
    view?.status === "ready" ? view.items.filter((item) => !item.archived).length : 0;
  const summary = view?.status === "ready" ? summarizeInventory(view.items) : null;

  const shell = classifyInventoryShell({
    loading: view == null && !fetchFailed,
    fetchFailed,
    status: view?.status ?? null,
    orgId,
    itemCount,
  });
  const shellCopy = inventoryShellCopy(shell);
  const nextActions = inventoryNextActions({
    orgId,
    shell,
    itemCount,
    lowStockCount: summary?.lowStock ?? 0,
    outOfStockCount: summary?.outOfStock ?? 0,
  });
  // Same rule as the shells: the overflow menu does not repeat a destination
  // the Next actions panel is already offering with a reason attached.
  const nextActionHrefs = new Set(nextActions.map((action) => action.href));
  const relatedLinks = inventoryRelatedLinks(orgId, {
    include: [...INVENTORY_RELATED_INCLUDE],
  }).filter((link) => !nextActionHrefs.has(link.href));
  const buildHref = withOrgHref("/build", orgId);
  const vendorsHref = withOrgHref("/vendors", orgId);
  const ordersHref = hubHref("/business", "orders", orgId);
  const spareForecastHref = hubHref("/build", "spare-forecast", orgId);
  const setupSteps = inventorySetupSteps(orgId);

  if (shell === "loading") {
    return <InventoryShell description={shellCopy.description} orgId={null} shell="loading" />;
  }

  if (shell === "error") {
    return (
      <InventoryShell
        description={shellCopy.description}
        orgId={orgId}
        shell="error"
        error={error || shellCopy.description}
        errorStatus={errorStatus}
        onRetry={() => void load()}
      />
    );
  }

  if (shell === "setup") {
    return (
      <InventoryShell
        description={
          view?.status === "setup_required" ? view.message : shellCopy.description
        }
        orgId={orgId}
        shell="setup"
      >
        {setupSteps.length > 0 ? (
          <ol className="strategy-setup-steps">
            {setupSteps.map((step) => (
              <li key={step.id}>
                <div>
                  <strong>{step.label}</strong>
                  <span>{step.detail}</span>
                </div>
                <a href={step.href}>Open</a>
              </li>
            ))}
          </ol>
        ) : null}
      </InventoryShell>
    );
  }

  if (view?.status !== "ready") {
    return <InventoryShell description={shellCopy.description} orgId={orgId} shell="setup" />;
  }

  const { context, items, locations } = view;
  const readyOrgId = context.orgId ?? "";
  const query = search.trim().toLowerCase();
  const visibleItems = items.filter((item) => {
    if (!showArchived && item.archived) return false;
    if (lowOnly && !isLowStock(item)) return false;
    if (sparesOnly && !item.isSpare) return false;
    if (category !== "all" && item.category !== category) return false;
    if (query) {
      const hay = `${item.name} ${item.partNumber ?? ""} ${item.vendor ?? ""} ${item.subsystem ?? ""} ${item.locationName ?? ""}`.toLowerCase();
      if (!hay.includes(query)) return false;
    }
    return true;
  });

  return (
    <main className="module-page inventory-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={buildHref}>Build</a>
            {" / Inventory"}
          </>
        }
        title="Inventory & BOM"
        description={`Parts & materials stock, storage locations, and per-mechanism bills of materials for ${context.orgName ?? "your team"}${context.teamNumber ? ` (Team ${context.teamNumber})` : ""}. Cross-check Vendors, Orders, and Spare Forecast — never DEMO stock metrics.`}
      >
        <div className="inventory-header-actions">
          {summary && summary.lowStock > 0 ? (
            <span className="app-badge setup">{formatInventoryMetric(summary.lowStock, true)} low</span>
          ) : null}
          {/* Header was: N related links + Add item + Scan/labels, all shouting equally.
              Now one primary, one secondary, and every related tool one keystroke away. */}
          <ActionMenu
            label="Inventory"
            overflowLabel="Related tools"
            maxSecondary={1}
            actions={[
              {
                id: "add-item",
                label: showAdd ? "Close add item" : "Add item",
                intent: "primary",
                onClick: () => setShowAdd((value) => !value),
              },
              {
                id: "labels",
                label: "Scan / labels",
                hint: "Print or scan location + item labels",
                onClick: () => setShowLabels((value) => !value),
              },
              ...relatedLinks.map<ActionSpec>((link) => ({
                id: `related:${link.id}`,
                label: link.label,
                href: link.href,
                group: "related",
              })),
            ]}
          />
        </div>
      </PageHeader>

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      <InventoryNextActionsPanel actions={nextActions} />

      {summary && shouldShowInventorySummaryTiles(summary.totalItems) ? (
        <SummaryTiles
          totalItems={summary.totalItems}
          lowStock={summary.lowStock}
          outOfStock={summary.outOfStock}
          value={summary.value}
        />
      ) : null}

      {shell === "empty" ? (
        <EmptyState
          soft
          badge="No parts yet"
          badgeTone="setup"
          title={shellCopy.title}
          description={shellCopy.description}
        >
          {/* One obvious first move; the three "go look somewhere else" links stop
              competing with it. */}
          <ActionMenu
            label="Get started with inventory"
            overflowLabel="Related tools"
            maxSecondary={0}
            actions={[
              {
                id: "add-first",
                label: "Add your first item",
                intent: "primary",
                onClick: () => setShowAdd(true),
              },
              // Third copy of the same three destinations, after the header
              // strip and the Next actions panel — kept only when the panel
              // above is not already offering it.
              ...[
                { id: "vendors", label: "Open Vendors", href: vendorsHref },
                { id: "orders", label: "Open Orders", href: ordersHref },
                { id: "spare-forecast", label: "Open Spare Forecast", href: spareForecastHref },
              ].filter((action) => !nextActionHrefs.has(action.href)),
            ]}
          />
        </EmptyState>
      ) : null}

      {showAdd ? (
        <AddItemForm
          orgId={readyOrgId}
          locations={locations}
          busy={busyKey === "create-item"}
          onCreate={(body) => void run(body, "create-item")}
          onClose={() => setShowAdd(false)}
        />
      ) : null}

      {showLabels ? (
        <InventoryLabelTools
          orgId={readyOrgId}
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
          Stock <b>{formatInventoryMetric(summary?.totalItems ?? 0, true)}</b>
        </button>
        <button type="button" className={tab === "locations" ? "active" : undefined} onClick={() => setTab("locations")}>
          Locations <b>{formatInventoryMetric(locations.length, true)}</b>
        </button>
        <button type="button" className={tab === "bom" ? "active" : undefined} onClick={() => setTab("bom")}>
          BOM <b>{formatInventoryMetric(new Set(view.bom.map((b) => b.subsystem)).size, true)}</b>
        </button>
      </nav>

      {tab === "stock" ? (
        <div id="inventory-stock" className="inventory-section">
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
              <input type="checkbox" checked={sparesOnly} onChange={(event) => setSparesOnly(event.target.checked)} />
              <span>Spares only</span>
            </label>
            <label className="inventory-check">
              <input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} />
              <span>Show archived</span>
            </label>
          </div>
          {items.length === 0 ? null : (
            <ul className="inventory-items">
              {visibleItems.map((item) => (
                <ItemRow key={item.id} item={item} locations={locations} orgId={readyOrgId} busyKey={busyKey} run={run} />
              ))}
              {visibleItems.length === 0 ? <p className="app-muted inventory-list-empty">No items match these filters.</p> : null}
            </ul>
          )}
        </div>
      ) : null}

      {tab === "locations" ? <LocationsPanel view={view} orgId={readyOrgId} busyKey={busyKey} run={run} /> : null}
      {tab === "bom" ? <BomPanel view={view} orgId={readyOrgId} busyKey={busyKey} run={run} /> : null}

      <Panel className="inventory-tip" aria-label="Inventory tip">
        <span className="eyebrow">Procurement path</span>
        {/* Prose, not a third set of buttons. Orders, Vendors and Spare Forecast
            each had a link here *and* a row in Next actions above — two controls
            for the same destination, the lower one with no reason attached. The
            panel keeps the sentence and gives up the links. */}
        <p className="app-muted" style={{ marginTop: 8 }}>
          Restock through Orders, keep suppliers in Vendors, and project spare exhaustion in Spare
          Forecast — never invent DEMO stock, costs, or reorder totals.
        </p>
      </Panel>

      <AiInsightPanel
        orgId={readyOrgId}
        kind="stock_advisor"
        title="Stock advisor"
        description="Reorder brief from low-stock thresholds and BOM shortfalls — what to buy before build hours are lost. Never DEMO stock metrics."
      />
    </main>
  );
}
