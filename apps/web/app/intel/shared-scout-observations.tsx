"use client";

import { useEffect, useState } from "react";
import type { IntelScoutNote } from "../../lib/intel/intel-related";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import { ScoutObservationExplorer } from "./scout-observation-explorer";

type SharedRow = IntelScoutNote & {
  sourceOrgId: string;
  sourceTeamNumber: number | null;
  schemaId: string;
  schemaVersion: number;
};
export function SharedScoutObservations({
  orgId,
  teamKey,
  eventKey,
}: {
  orgId: string;
  teamKey: string;
  eventKey: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<SharedRow[]>([]);
  const [status, setStatus] = useState("");
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    if (!open || !eventKey) return;
    const controller = new AbortController();
    setRows([]);
    setStatus("Checking current sharing permissions…");
    // Shared data is deliberately not saved in Vantage's offline cache.
    void fetch(
      "/api/scouting/shared?" +
        new URLSearchParams({ orgId, teamKey, eventKey }),
      {
        cache: "no-store",
        signal: AbortSignal.any([
          controller.signal,
          AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
        ]),
      },
    )
      .then(async (response) => {
        if (!response.ok) throw new Error();
        return response.json() as Promise<{
          rows: SharedRow[];
          truncated: boolean;
        }>;
      })
      .then((data) => {
        if (!controller.signal.aborted) {
          setRows(data.rows);
          setStatus(
            data.truncated
              ? "Showing the first 2,000 reports. This is a partial dataset."
              : data.rows.length
                ? ""
                : "No other teams are sharing observations for this robot at this event.",
          );
        }
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setStatus(
            "Shared scouting is unavailable. Connect and refresh to check current permissions.",
          );
      });
    return () => controller.abort();
  }, [orgId, teamKey, eventKey, open, refresh]);
  const groups = new Map<string, SharedRow[]>();
  for (const row of rows) {
    const key = row.sourceOrgId + ":" + row.schemaId;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return (
    <details
      className="intel-shared-scouting"
      open={open}
      onToggle={(event) => {
        setOpen(event.currentTarget.open);
        if (!event.currentTarget.open) setRows([]);
      }}
    >
      <summary data-disclosure>Shared scouting from other teams</summary>
      <p className="app-muted">
        Event: {eventKey ?? "choose an active event"}. Sources and form versions
        stay separate so different units are never mixed. Private notes and
        scout identities are excluded. Shared reports are available online;
        turning sharing off stops future access but cannot recall copies someone
        already saved.
      </p>
      {open && eventKey ? (
        <button
          type="button"
          className="text-button"
          onClick={() => setRefresh((value) => value + 1)}
        >
          Refresh shared scouting
        </button>
      ) : null}
      {status ? <p role="status">{status}</p> : null}
      {[...groups].map(([key, group]) => (
        <ScoutObservationExplorer
          key={key}
          rows={group}
          activeEventKey={eventKey}
          privateNotes={false}
          sourceLabel={
            (group[0]!.sourceTeamNumber
              ? "Team " + group[0]!.sourceTeamNumber
              : "a Vantage team") +
            " · form v" +
            group[0]!.schemaVersion
          }
        />
      ))}
    </details>
  );
}
