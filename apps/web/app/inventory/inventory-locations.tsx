"use client";

import { useState } from "react";
import { Button } from "../../components/ui";
import { LOCATION_KINDS } from "../../lib/inventory";
import { type ReadyView, type RunFn } from "./inventory-model";

export function LocationsPanel({
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
        <Button variant="secondary" type="submit" disabled={busy || !name.trim()}>
          Add location
        </Button>
      </form>
    </div>
  );
}
