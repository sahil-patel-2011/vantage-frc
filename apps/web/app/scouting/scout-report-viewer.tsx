"use client";

import { useState } from "react";
import { Button } from "../../components/ui";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import { formatReportClock, scoutReportFromPayload } from "../../lib/scouting/scout-report";
import type { RecentEntry } from "./scouting-model";

export function ScoutReportViewer({
  entries,
  orgId,
  canDelete,
  onDeleted,
}: {
  entries: RecentEntry[];
  orgId: string;
  canDelete: boolean;
  onDeleted: () => void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  return (
    <ul className="scout-entry-list">
      {entries.map((entry) => {
        const open = openId === entry.id;
        const report = open ? scoutReportFromPayload(entry.payload) : null;
        const type = entry.type === "pit" ? "pit" : "match";
        return (
          <li key={entry.id}>
            <button
              type="button"
              className="text-button scout-report-open"
              onClick={() => setOpenId(open ? null : entry.id)}
            >
              <strong>
                {entry.matchKey ?? "PIT"} · {entry.teamKey}
              </strong>
              <span>
                {entry.scoutName} · {entry.source}
              </span>
              <small className="app-muted">
                {entry.confidence} confidence · {new Date(entry.updatedAt).toLocaleTimeString()}
              </small>
            </button>
            {open && report ? (
              <div className="scout-report-viewer">
                {error ? (
                  <p className="telemetry-status" role="alert">
                    {error}
                  </p>
                ) : null}
                <div className="scout-report-tabs">
                  <section aria-label="Reported stats">
                    <h3>Stats</h3>
                    {report.stats.length === 0 ? (
                      <p className="app-muted">This report has no stored numbers yet.</p>
                    ) : (
                      <dl>
                        {report.stats.map((stat) => (
                          <div key={stat.key}>
                            <dt>{stat.label}</dt>
                            <dd>{stat.value}</dd>
                          </div>
                        ))}
                      </dl>
                    )}
                  </section>
                  <section aria-label="Reported actions">
                    <h3>Timeline</h3>
                    {report.timeline.length === 0 ? (
                      <p className="app-muted">No timed actions were recorded on this report.</p>
                    ) : (
                      <ol>
                        {report.timeline.map((event, index) => (
                          <li key={`${event.label}-${index}`}>
                            <time>{formatReportClock(event.atSeconds)}</time>
                            <span>{event.label}</span>
                          </li>
                        ))}
                      </ol>
                    )}
                  </section>
                </div>
                {canDelete ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() => {
                      if (!window.confirm(`Delete the report for ${entry.teamKey}? This cannot be undone.`)) {
                        return;
                      }
                      setBusy(true);
                      setError("");
                      void (async () => {
                        try {
                          const response = await fetch("/api/scouting/reports", {
                            method: "POST",
                            headers: { "content-type": "application/json" },
                            body: JSON.stringify({
                              orgId,
                              entryId: entry.id,
                              type,
                              action: "delete",
                            }),
                            signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
                          });
                          const data = (await response.json()) as { ok?: boolean; error?: string };
                          if (!response.ok || !data.ok) {
                            setError(data.error || "Could not delete that report.");
                            return;
                          }
                          setOpenId(null);
                          onDeleted();
                        } catch {
                          setError("Network error — please try again.");
                        } finally {
                          setBusy(false);
                        }
                      })();
                    }}
                  >
                    Delete report
                  </Button>
                ) : null}
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
