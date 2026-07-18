"use client";

import type { DataSourceHealthView } from "../lib/reference-health";
import "./data-source-degraded-banner.css";

type Props = {
  health: DataSourceHealthView | null | undefined;
  compact?: boolean;
};

export function DataSourceDegradedBanner({ health, compact = false }: Props) {
  if (!health?.degraded) return null;

  const etagBits = health.sources
    .filter((source) => source.etagResources > 0 || source.erroredResources > 0)
    .map((source) => {
      const parts = [`${source.source.toUpperCase()} ETags ${source.etagResources}`];
      if (source.erroredResources > 0) parts.push(`${source.erroredResources} cursor error(s)`);
      return parts.join(" · ");
    });

  return (
    <aside
      className={`data-source-degraded-banner${compact ? " compact" : ""} mode-${health.mode}`}
      role="status"
      aria-live="polite"
    >
      <div>
        <span className="app-badge setup">Data source {health.mode}</span>
        <strong>{health.bannerTitle}</strong>
        <p>{health.bannerDetail}</p>
        {etagBits.length ? <small>{etagBits.join(" · ")}</small> : null}
        {health.usingLastGoodCache ? (
          <small className="data-source-cache-note">Serving last-good Neon reference cache — strategy continues.</small>
        ) : null}
      </div>
      <a className="app-button secondary" href={health.teamDataHref}>
        Team → Data
      </a>
    </aside>
  );
}
