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
  if (!health?.degraded) return null;

  if (compact) {
    // One quiet line while closed; the technical detail and the one action live inside.
    return (
      <aside className={`data-source-degraded-banner compact mode-${health.mode}`} role="status" aria-live="polite">
        <details className="data-source-summary">
          <summary data-disclosure>
            <strong>{health.bannerTitle}</strong>
            <span>{health.usingLastGoodCache ? "Using saved copy" : "Details"}</span>
          </summary>
          <p>{health.bannerDetail}</p>
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
          {health.mode === "stale" ? "May be out of date" : health.usingLastGoodCache ? "Using saved copy" : "Data unavailable"}
        </span>
        <strong>{health.bannerTitle}</strong>
        <p>{health.bannerDetail}</p>
        {health.usingLastGoodCache ? (
          <small className="data-source-cache-note">Showing the last saved rankings and schedule. Strategy still works.</small>
        ) : null}
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
