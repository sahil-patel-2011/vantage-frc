"use client";

import { catalogEntry, type DashboardWidgetLayout } from "../../lib/dashboard/catalog";
import { HIDDEN_ON_HOME_COPY, type HiddenOnHomeReason } from "../../lib/dashboard/edit-mode";

/** "a, b and c" */
function listWords(words: string[]): string {
  if (words.length <= 1) return words[0] ?? "";
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

/*
  Cards on this board that Home is leaving out right now, as one row under the
  board in edit mode. They used to sit on the board as full-size dimmed cards —
  a 324px "Setup" card at the top and four more — pushing the board you were
  arranging a screen down. Closed until you want it; each card can be kept
  (the default: it comes back on its own), always shown, or removed.
*/
export function DashboardHiddenRow({
  rows,
  reasons,
  onAlwaysShow,
  onRemove,
}: {
  rows: DashboardWidgetLayout[];
  reasons: ReadonlyMap<string, HiddenOnHomeReason>;
  onAlwaysShow: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  if (rows.length === 0) return null;
  const labelOf = (item: DashboardWidgetLayout) => catalogEntry(item.type)?.label ?? item.type;
  return (
    <details className="dash-hidden-row" data-testid="dash-hidden-row">
      <summary>
        <span>Hidden right now ({rows.length})</span>
        <small>{listWords(rows.map(labelOf))}</small>
      </summary>
      <p>These stay on this board and come back on their own. Always show keeps one on Home even when it is empty.</p>
      <ul>
        {rows.map((item) => {
          const label = labelOf(item);
          const reason = reasons.get(item.i);
          return (
            <li key={item.i} data-testid="dash-hidden-item" data-widget-type={item.type}>
              <span>
                <strong>{label}</strong>
                <small>{reason ? HIDDEN_ON_HOME_COPY[reason] : null}</small>
              </span>
              <button
                type="button"
                data-testid="dash-always-show"
                aria-label={`Always show ${label} on Home`}
                onClick={() => onAlwaysShow(item.i)}
              >
                Always show
              </button>
              <button
                type="button"
                className="is-quiet"
                data-testid="dash-hidden-remove"
                aria-label={`Remove ${label} from this board`}
                onClick={() => onRemove(item.i)}
              >
                Remove
              </button>
            </li>
          );
        })}
      </ul>
    </details>
  );
}
