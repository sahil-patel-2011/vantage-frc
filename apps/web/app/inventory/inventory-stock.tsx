"use client";

import { categoryLabel, INVENTORY_CATEGORIES, type InventoryItem } from "../../lib/inventory";
import { ItemRow } from "./inventory-items";
import { type ReadyView, type RunFn } from "./inventory-model";

export function InventoryStockPanel({
  items,
  visibleItems,
  locations,
  orgId,
  busyKey,
  run,
  search,
  category,
  lowOnly,
  sparesOnly,
  showArchived,
  onSearch,
  onCategory,
  onLowOnly,
  onSparesOnly,
  onShowArchived,
}: {
  items: InventoryItem[];
  visibleItems: InventoryItem[];
  locations: ReadyView["locations"];
  orgId: string;
  busyKey: string | null;
  run: RunFn;
  search: string;
  category: string;
  lowOnly: boolean;
  sparesOnly: boolean;
  showArchived: boolean;
  onSearch: (value: string) => void;
  onCategory: (value: string) => void;
  onLowOnly: (value: boolean) => void;
  onSparesOnly: (value: boolean) => void;
  onShowArchived: (value: boolean) => void;
}) {
  return (
    <div id="inventory-stock" className="inventory-section">
      <div className="inventory-toolbar">
        <input
          className="inventory-search"
          placeholder="Search name, part #, vendor, subsystem…"
          value={search}
          onChange={(event) => onSearch(event.target.value)}
        />
        <select value={category} onChange={(event) => onCategory(event.target.value)}>
          <option value="all">All categories</option>
          {INVENTORY_CATEGORIES.map((value) => (
            <option key={value} value={value}>
              {categoryLabel(value)}
            </option>
          ))}
        </select>
        <label className="inventory-check">
          <input type="checkbox" checked={lowOnly} onChange={(event) => onLowOnly(event.target.checked)} />
          <span>Low only</span>
        </label>
        <label className="inventory-check">
          <input type="checkbox" checked={sparesOnly} onChange={(event) => onSparesOnly(event.target.checked)} />
          <span>Spares only</span>
        </label>
        <label className="inventory-check">
          <input type="checkbox" checked={showArchived} onChange={(event) => onShowArchived(event.target.checked)} />
          <span>Show archived</span>
        </label>
      </div>
      {items.length === 0 ? null : (
        <ul className="inventory-items">
          {visibleItems.map((item) => (
            <ItemRow key={item.id} item={item} locations={locations} orgId={orgId} busyKey={busyKey} run={run} />
          ))}
          {visibleItems.length === 0 ? (
            <p className="app-muted inventory-list-empty">No items match these filters.</p>
          ) : null}
        </ul>
      )}
    </div>
  );
}
