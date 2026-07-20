import type { ReactNode } from "react";
import styles from "./ui.module.css";

type Health = "ok" | "degraded" | "cached";

type SourceTagProps = {
  /** "TBA" | "Statbotics" | "manual" | any provider label. */
  source: ReactNode;
  health?: Health;
  /** Optional trailing note, e.g. "synced 4m ago". */
  note?: ReactNode;
  icon?: ReactNode;
  className?: string;
};

const healthDot: Record<Health, string | undefined> = {
  ok: styles.provOk,
  degraded: styles.provDegraded,
  cached: styles.provCached,
};
const healthLabel: Record<Health, string> = {
  ok: "healthy",
  degraded: "degraded",
  cached: "cached",
};

/**
 * Provenance chip — attributes where data came from (TBA / Statbotics / manual) with an
 * optional health dot. Makes the shared, rate-limited TBA cache legible instead of "broken".
 */
export function SourceTag({ source, health, note, icon, className }: SourceTagProps) {
  return (
    <span className={[styles.provChip, className].filter(Boolean).join(" ")}>
      {icon ?? (health ? (
        <span
          className={[styles.provDot, healthDot[health]].join(" ")}
          role="img"
          aria-label={healthLabel[health]}
        />
      ) : null)}
      <span>{source}</span>
      {note != null ? <span style={{ opacity: 0.8 }}>· {note}</span> : null}
    </span>
  );
}
