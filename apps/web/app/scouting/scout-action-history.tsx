"use client";
import { actionHistory } from "@vantage/scouting";

export function ScoutActionHistoryView({ payload, labels }: { payload: Record<string, unknown>; labels: Record<string, string> }) {
  const history = actionHistory(payload);
  if (!history?.events.length) return null;
  const value = (exists: boolean, item: unknown) => !exists ? "Not recorded" : typeof item === "object" ? JSON.stringify(item) : String(item ?? "Empty");
  return <details className="scout-action-history"><summary>Review {history.events.length} recorded actions</summary>
    <p>Times come from this device. Corrections remain in the history.</p>
    <ol>{history.events.map((event) => <li key={event.id}><time dateTime={event.at}>{new Date(event.at).toLocaleTimeString()}</time>
      {event.changes.map((change) => <p key={change.field}><strong>{labels[change.field] ?? change.field}</strong>: {value(change.beforeExists, change.before)} → {value(change.afterExists, change.after)}</p>)}
    </li>)}</ol>
  </details>;
}
