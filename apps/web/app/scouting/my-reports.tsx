"use client";

import { matchOrderKey } from "../../lib/scouting/next-assignment";
import { labelForMatchKey } from "../../lib/scouting/next-match";
import { savedWhen } from "../../lib/scouting/scout-report";
import type { MyEntry } from "./scouting-model";
import "./my-reports.css";

/** Latest match first; pit reports after the matches. */
function matchOrderKeyFor(report: MyEntry): [number, number, number] {
  return (report.matchKey ? matchOrderKey(report.matchKey) : null) ?? [-1, 0, 0];
}

/**
 * "Your reports": every report this scout filed at the event, each with Edit.
 *
 * "Fix it" only lasted until the next save, and the saved-entries list was read-only, so a scout
 * who noticed a mistake an hour later had no way to correct it. Edit opens the report in the form;
 * Save replaces it (the same id, so the team keeps one report, not two).
 */
export function MyReports({
  reports,
  pendingCount,
  onEdit,
}: {
  reports: MyEntry[];
  /** Saved on this phone and not uploaded yet: not in this list until they are. */
  pendingCount: number;
  onEdit: (report: MyEntry) => void;
}) {
  if (!reports.length && !pendingCount) return null;
  const ordered = [...reports].sort((a, b) => {
    const left = matchOrderKeyFor(a);
    const right = matchOrderKeyFor(b);
    return right[0] - left[0] || right[1] - left[1] || right[2] - left[2] || b.updatedAt.localeCompare(a.updatedAt);
  });
  return (
    <details className="scout-my-reports">
      <summary>
        <span>Your reports</span>
        <small>
          {reports.length === 1 ? "1 at this event" : `${reports.length} at this event`}
          {pendingCount ? ` · ${pendingCount} waiting to upload` : ""}
        </small>
      </summary>
      {ordered.length ? (
        <ul>
          {ordered.map((report) => (
            <li key={report.id}>
              <div>
                <strong>
                  {report.type === "pit" ? "Pit" : report.matchKey ? (labelForMatchKey(report.matchKey) ?? report.matchKey) : "Match"}{" "}
                  · {report.teamKey.replace(/^frc/i, "")}
                </strong>
                <small>{savedWhen(report.updatedAt)}</small>
              </div>
              <button
                type="button"
                className="scout-my-reports-edit"
                disabled={!report.clientId}
                onClick={() => onEdit(report)}
                aria-label={`Edit your ${report.type === "pit" ? "pit" : "match"} report for ${report.teamKey.replace(/^frc/i, "")}`}
              >
                Edit
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="app-muted">Your reports show here once they upload.</p>
      )}
    </details>
  );
}
