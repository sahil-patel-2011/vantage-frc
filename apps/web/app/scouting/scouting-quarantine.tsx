"use client";

import { Button, Panel } from "../../components/ui";
import { mediaKindLabel } from "../../lib/scouting/media-downscale";
import type { QuarantinedItem } from "../../lib/scout-offline";

export function quarantineItemLabel(item: QuarantinedItem): string {
  if (item.kind === "entry") {
    const entry = item.entry;
    return `${entry.type === "pit" ? "Pit" : "Match"} entry · ${entry.teamKey}${
      entry.matchKey ? ` · ${entry.matchKey}` : ""
    }`;
  }
  const teamKey = typeof item.metadata.teamKey === "string" ? item.metadata.teamKey : "";
  return `${mediaKindLabel(item.metadata.kind)}${teamKey ? ` · ${teamKey}` : ""}`;
}

/** "N entries need attention" — permanently rejected items with Retry/Discard. */
export function ScoutQuarantinePanel({
  items,
  onRetry,
  onDiscard,
}: {
  items: QuarantinedItem[];
  onRetry: (clientId: string) => void;
  onDiscard: (clientId: string) => void;
}) {
  if (!items.length) return null;
  return (
    <Panel
      as="section"
      className="scout-quarantine-panel"
      style={{ minHeight: "auto", marginBottom: 14 }}
      aria-label="Entries needing attention"
    >
      <header>
        <h2 style={{ marginTop: 0 }}>
          {items.length} {items.length === 1 ? "entry needs" : "entries need"} attention
        </h2>
        <p className="app-muted">
          Sync rejected these; everything else kept syncing. They stay on this device until you
          retry or discard each one.
        </p>
      </header>
      <ul className="scout-quarantine-list" style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {items.map((item) => (
          <li
            key={item.clientId}
            style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", padding: "8px 0" }}
          >
            <div style={{ flex: "1 1 240px", display: "grid", gap: 2 }}>
              <strong>{quarantineItemLabel(item)}</strong>
              <span>{item.reason}</span>
              <small className="app-muted">{new Date(item.quarantinedAt).toLocaleString()}</small>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <Button variant="secondary" type="button" onClick={() => onRetry(item.clientId)}>
                Retry
              </Button>
              <button type="button" className="text-button" onClick={() => onDiscard(item.clientId)}>
                Discard
              </button>
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
