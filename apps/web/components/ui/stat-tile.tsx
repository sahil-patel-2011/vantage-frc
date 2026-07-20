import type { ReactNode } from "react";
import styles from "./ui.module.css";

type Delta = { value: string; tone: "up" | "down" | "flat" };

type StatTileProps = {
  label: ReactNode;
  value: ReactNode;
  unit?: ReactNode;
  delta?: Delta;
  /** e.g. <Freshness/> or <DataSourceFooter/>. */
  footer?: ReactNode;
  /** Whole-tile link. */
  href?: string;
  /** Flat/borderless KPI (default). Set false for a bordered card treatment. */
  flat?: boolean;
  className?: string;
};

const deltaClass = { up: styles.deltaUp, down: styles.deltaDown, flat: styles.deltaFlat } as const;
const deltaArrow = { up: "↑", down: "↓", flat: "→" } as const;

/**
 * KPI tile — preattentive hierarchy: large number + small label. FLAT by default
 * (reserve bordered cards for structural grids). Skeleton preset `StatRowSkeleton` mirrors this.
 */
export function StatTile({
  label,
  value,
  unit,
  delta,
  footer,
  href,
  flat = true,
  className,
}: StatTileProps) {
  const cls = [
    styles.statTile,
    flat ? styles.statTileFlat : styles.statTileCard,
    href ? styles.statTileLink : undefined,
    className,
  ]
    .filter(Boolean)
    .join(" ");

  const body = (
    <>
      <span className={styles.statLabel}>{label}</span>
      <span className={styles.statValueRow}>
        <span className={styles.statValue}>{value}</span>
        {unit != null ? <span className={styles.statUnit}>{unit}</span> : null}
        {delta ? (
          <span className={[styles.statDelta, deltaClass[delta.tone]].join(" ")}>
            <span aria-hidden="true">{deltaArrow[delta.tone]}</span>
            {delta.value}
          </span>
        ) : null}
      </span>
      {footer != null ? <span className={styles.statFooter}>{footer}</span> : null}
    </>
  );

  if (href) {
    return (
      <a href={href} className={cls}>
        {body}
      </a>
    );
  }
  return <div className={cls}>{body}</div>;
}
