"use client";
import { Button } from "./ui";

import type { DataSourceHealthView } from "../lib/reference-health";
import "./data-source-degraded-banner.css";

type Props = {
  health: DataSourceHealthView | null | undefined;
  compact?: boolean;
};

export function DataSourceDegradedBanner({ health, compact = false }: Props) {
  if (!health?.degraded) return null;

  return (
    <aside
      className={`data-source-degraded-banner${compact ? " compact" : ""} mode-${health.mode}`}
      role="status"
      aria-live="polite"
    >
      <div>
        <span className="app-badge setup">{health.mode === "stale" ? "May be out of date" : "Using saved copy"}</span>
        <strong>{health.bannerTitle}</strong>
        <p>{health.bannerDetail}</p>
        {health.usingLastGoodCache ? (
          <small className="data-source-cache-note">Showing the last saved rankings and schedule. Strategy still works.</small>
        ) : null}
      </div>
      <Button as="a" variant="secondary" href={health.teamDataHref}>
        Team → Data
      </Button>
    </aside>
  );
}
