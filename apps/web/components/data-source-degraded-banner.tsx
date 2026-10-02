"use client";
import { Button } from "./ui";

import type { DataSourceHealthView } from "../lib/reference-health";
import "./data-source-degraded-banner.css";

type Props = {
  health: DataSourceHealthView | null | undefined;
  compact?: boolean;
  /** Owner or admin may open Team Data. Omitted stays closed. */
  canOpenTeamData?: boolean;
};

export function DataSourceDegradedBanner({ health, compact = false, canOpenTeamData = false }: Props) {
  // A successful recovery is invisible. Individual features still report a
  // missing result; provider diagnostics remain available in Team Data.
  if (!health?.degraded || health.usingLastGoodCache || health.cacheHasRows) return null;

  if (compact) {
    // One quiet line while closed; the technical detail and the one action live inside.
    return (
      <aside className={`data-source-degraded-banner compact mode-${health.mode}`} role="status" aria-live="polite">
        <details className="data-source-summary">
          <summary data-disclosure>
            <strong>Rankings and schedule unavailable</strong>
            <span>Details</span>
          </summary>
          <p>We couldn’t load event data. Try again in a moment.</p>
          {canOpenTeamData ? (
            <a className="data-source-settings" href={health.teamDataHref}>Open data settings</a>
          ) : (
            <p>An owner or admin can refresh this in Team → Data.</p>
          )}
        </details>
      </aside>
    );
  }

  return (
    <aside
      className={`data-source-degraded-banner mode-${health.mode}`}
      role="status"
      aria-live="polite"
    >
      <div>
        <span className="app-badge setup">
          Data unavailable
        </span>
        <strong>Rankings and schedule unavailable</strong>
        <p>We couldn’t load event data. Try again in a moment.</p>
      </div>
      {canOpenTeamData ? (
        <Button as="a" variant="secondary" href={health.teamDataHref}>
          Team → Data
        </Button>
      ) : (
        <p className="data-source-cache-note">An owner or admin refreshes this under Team → Data.</p>
      )}
    </aside>
  );
}
