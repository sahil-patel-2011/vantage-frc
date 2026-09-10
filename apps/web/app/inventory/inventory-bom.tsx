"use client";

import { useMemo, useState } from "react";
import { Button } from "../../components/ui";
import { bomCoverage } from "../../lib/inventory";
import { fmtQty, type ReadyView, type RunFn } from "./inventory-model";

export function BomPanel({
  view,
  orgId,
  busyKey,
  run,
}: {
  view: ReadyView;
  orgId: string;
  busyKey: string | null;
  run: RunFn;
}) {
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
          void run({ action: "set_bom", orgId, subsystem: subsystem.trim(), itemId, quantityNeeded: needed }, "bom").then(
            () => setQty(""),
          );
        }}
      >
        <input
          placeholder="Subsystem (e.g. Arm)"
          value={subsystem}
          disabled={busy}
          onChange={(e) => setSubsystem(e.target.value)}
        />
        <select value={itemId} disabled={busy} onChange={(e) => setItemId(e.target.value)}>
          <option value="">Select part…</option>
          {activeItems.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
        <input
          type="number"
          step="any"
          min={0}
          placeholder="Qty needed"
          value={qty}
          disabled={busy}
          onChange={(e) => setQty(e.target.value)}
        />
        <Button variant="secondary" type="submit" disabled={busy || !subsystem.trim() || !itemId || !qty}>
          Add to BOM
        </Button>
      </form>
    </div>
  );
}
