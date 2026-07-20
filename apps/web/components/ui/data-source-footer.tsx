import { relativeTime } from "./relative-time";
import styles from "./ui.module.css";

type Health = "ok" | "degraded" | "cached";

type DataSourceFooterProps = {
  source: "TBA" | "Statbotics" | "manual" | string;
  health?: Health;
  /** ISO timestamp of last sync. */
  syncedAt?: string;
  className?: string;
};

const dotClass: Record<Health, string | undefined> = {
  ok: styles.provOk,
  degraded: styles.provDegraded,
  cached: styles.provCached,
};

/**
 * Provenance / freshness footer for reference + dashboard widgets. Sourced from the existing
 * `dataSourceHealth` on snapshot.ts — "TBA · synced 4m ago" / "Statbotics · degraded, cached".
 */
export function DataSourceFooter({ source, health = "ok", syncedAt, className }: DataSourceFooterProps) {
  const synced = syncedAt ? relativeTime(syncedAt) : null;
  const suffix =
    health === "degraded"
      ? "degraded, showing cached data"
      : health === "cached"
        ? "cached"
        : synced
          ? `synced ${synced}`
          : null;
  return (
    <p className={[styles.sourceFooter, className].filter(Boolean).join(" ")} style={{ margin: 0 }}>
      <span className={[styles.provDot, dotClass[health]].join(" ")} aria-hidden="true" />
      <span>
        {source}
        {suffix ? ` · ${suffix}` : ""}
      </span>
    </p>
  );
}
