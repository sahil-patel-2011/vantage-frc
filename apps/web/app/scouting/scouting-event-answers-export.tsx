"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ExportButton } from "../../components/ui/export-button";
import {
  eventAnswerColumns,
  type EventAnswerRow,
  type EventAnswersSnapshot,
} from "../../lib/scouting/event-answers-csv";

type ScoutingEventAnswersExportProps = {
  orgId: string;
  eventKey: string | null;
  online: boolean;
  revision?: string;
};

export function ScoutingEventAnswersExport({
  orgId,
  eventKey,
  online,
  revision,
}: ScoutingEventAnswersExportProps) {
  const [snapshot, setSnapshot] = useState<EventAnswersSnapshot | null>(null);
  const [loadError, setLoadError] = useState("");
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;

  const load = useCallback(async () => {
    if (!orgId || !eventKey) {
      setSnapshot(null);
      setLoadError("");
      return;
    }
    if (!online) {
      if (!snapshotRef.current) {
        setLoadError(
          "Need a connection to download this event's answers. The offline queue is not in this file.",
        );
      }
      return;
    }
    try {
      const response = await fetch(`/api/scouting/answers?orgId=${encodeURIComponent(orgId)}`, {
        headers: { accept: "application/json" },
        cache: "no-store",
      });
      const data = (await response.json()) as EventAnswersSnapshot & { error?: string };
      if (!response.ok) {
        setSnapshot(null);
        setLoadError(data.error ?? "Could not load this event's answers.");
        return;
      }
      setSnapshot({
        eventKey: data.eventKey ?? eventKey,
        matchDefinition: data.matchDefinition ?? null,
        pitDefinition: data.pitDefinition ?? null,
        rows: Array.isArray(data.rows) ? data.rows : [],
      });
      setLoadError("");
    } catch {
      setSnapshot(null);
      setLoadError("Could not load this event's answers.");
    }
  }, [orgId, eventKey, online]);

  useEffect(() => {
    void load();
  }, [load, revision]);

  const columns = useMemo(
    () => eventAnswerColumns(snapshot?.matchDefinition ?? null, snapshot?.pitDefinition ?? null),
    [snapshot],
  );
  const rows: readonly EventAnswerRow[] = snapshot?.rows ?? [];
  const ready = Boolean(eventKey) && snapshot != null && !loadError;

  return (
    <div data-testid="scouting-event-answers-export">
      <ExportButton
        rows={rows}
        columns={columns}
        feature="Scouting answers"
        orgLabel={eventKey}
        orgId={orgId}
        size="sm"
        label="Download this event's answers"
        allowEmpty
        disabled={!ready}
        description={
          eventKey
            ? `${eventKey} — ${rows.length} ${rows.length === 1 ? "row" : "rows"} of synced match and pit answers. UTF-8 CSV, opens in Sheets, Excel, or Tableau. Columns follow the published forms.`
            : "Set an active event to download answers."
        }
        provenance="Payload cells stay blank when that form field was unanswered. Empty event downloads headers only. Anything still queued offline is not included — Export Center still has the JSON takeout."
      />
      {loadError ? (
        <p className="app-muted" role="status">
          {loadError}
        </p>
      ) : null}
    </div>
  );
}
