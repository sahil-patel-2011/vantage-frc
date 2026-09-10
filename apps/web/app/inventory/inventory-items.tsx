"use client";

import { useState } from "react";
import { Button } from "../../components/ui";
import { ActionMenu } from "../../components/ui/action-menu";
import {
  categoryLabel,
  INVENTORY_CATEGORIES,
  isLowStock,
  TX_REASONS,
  type InventoryItem,
  type TxReason,
} from "../../lib/inventory";
import { fmtQty, type ActionBody, type ReadyView, type RunFn } from "./inventory-model";

export function ItemRow({
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
  run: RunFn;
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
              void run(
                { action: "adjust_stock", orgId, itemId: item.id, delta: amount, reason, note: note.trim() },
                `item:${item.id}`,
              );
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
          <input
            placeholder="Note (optional)"
            value={note}
            disabled={busy}
            onChange={(event) => setNote(event.target.value)}
          />
          <Button variant="secondary" size="sm" type="submit" disabled={busy || !delta}>
            Apply
          </Button>
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
  run: RunFn;
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
        <input
          type="number"
          step="any"
          min={0}
          value={minQuantity}
          disabled={busy}
          onChange={(e) => setMinQuantity(e.target.value)}
        />
      </label>
      <label className="inventory-field">
        <span>Unit cost</span>
        <input
          type="number"
          step="any"
          min={0}
          placeholder="—"
          value={unitCost}
          disabled={busy}
          onChange={(e) => setUnitCost(e.target.value)}
        />
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
        <input
          value={subsystem}
          disabled={busy}
          placeholder="e.g. Drivetrain"
          onChange={(e) => setSubsystem(e.target.value)}
        />
      </label>
      <label className="inventory-check">
        <input type="checkbox" checked={isSpare} disabled={busy} onChange={(e) => setIsSpare(e.target.checked)} />
        <span>Held as a spare</span>
      </label>
      {/* Archive + Delete moved into this item's overflow menu (see ItemRow) so the edit
          form has exactly one action: save what you just typed. */}
      <div className="inventory-edit-actions">
        <Button variant="secondary" size="sm" type="submit" disabled={busy}>
          Save
        </Button>
        <button type="button" className="inventory-link" disabled={busy} onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
}

export function AddItemForm({
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
        Quantities and costs come from real parts. Adding a common COTS part?{" "}
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
          <input
            type="number"
            step="any"
            min={0}
            placeholder="0"
            value={initialQuantity}
            disabled={busy}
            onChange={(e) => setInitialQuantity(e.target.value)}
          />
        </label>
        <label className="inventory-field">
          <span>Reorder at</span>
          <input
            type="number"
            step="any"
            min={0}
            placeholder="0"
            value={minQuantity}
            disabled={busy}
            onChange={(e) => setMinQuantity(e.target.value)}
          />
        </label>
        <label className="inventory-field">
          <span>Unit cost</span>
          <input
            type="number"
            step="any"
            min={0}
            placeholder="—"
            value={unitCost}
            disabled={busy}
            onChange={(e) => setUnitCost(e.target.value)}
          />
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
          <input
            value={subsystem}
            disabled={busy}
            placeholder="e.g. Drivetrain"
            onChange={(e) => setSubsystem(e.target.value)}
          />
        </label>
        {/* The spare flag crosses category and kind (0520): a spare gearbox is
            still category 'gearbox'. Without this checkbox nothing in the
            product could ever write the column Spare Forecast reads. */}
        <label className="inventory-check">
          <input type="checkbox" checked={isSpare} disabled={busy} onChange={(e) => setIsSpare(e.target.checked)} />
          <span>Held as a spare</span>
        </label>
      </div>
      <Button variant="primary" type="submit" disabled={busy || !name.trim()}>
        {busy ? "Adding…" : "Add item"}
      </Button>
    </form>
  );
}
