import type { CSSProperties } from "react";
import styles from "./ui.module.css";

type SkeletonProps = {
  variant?: "line" | "block" | "circle";
  width?: string | number;
  height?: string | number;
  radius?: string | number;
  className?: string;
  style?: CSSProperties;
  /** Always decorative — the wrapping region carries aria-busy. */
  "aria-hidden"?: true;
};

const size = (v: string | number | undefined): string | undefined =>
  v == null ? undefined : typeof v === "number" ? `${v}px` : v;

/** Pulsing shimmer placeholder. prefers-reduced-motion aware (see ui.module.css). */
export function Skeleton({
  variant = "line",
  width = "100%",
  height,
  radius,
  className,
  style,
}: SkeletonProps) {
  const w = size(width);
  const h =
    size(height) ?? (variant === "line" ? "1em" : variant === "circle" ? w : "100%");
  const r =
    size(radius) ?? (variant === "circle" ? "999px" : "var(--soft-radius-sm, 12px)");
  return (
    <span
      aria-hidden="true"
      className={[styles.skeleton, className].filter(Boolean).join(" ")}
      style={{ width: w, height: h, borderRadius: r, ...style }}
    />
  );
}

/** Row of StatTile placeholders — mirrors the flat KPI layout (1.9). */
export function StatRowSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className={styles.skeletonStatRow} aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className={styles.skeletonStatTile}>
          <Skeleton width="55%" height={11} />
          <Skeleton width="70%" height={28} />
          <Skeleton width="40%" height={11} />
        </div>
      ))}
    </div>
  );
}

/** Table placeholder — matches DataTable header + rows so nothing shifts on load. */
export function TableSkeleton({ rows = 6, cols = 4 }: { rows?: number; cols?: number }) {
  const cssCols = `repeat(${cols}, minmax(0, 1fr))`;
  return (
    <div className={styles.skeletonTable} aria-hidden="true">
      <div className={styles.skeletonTableRow} style={{ gridTemplateColumns: cssCols }}>
        {Array.from({ length: cols }, (_, i) => (
          <Skeleton key={i} width="60%" height={11} />
        ))}
      </div>
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className={styles.skeletonTableRow} style={{ gridTemplateColumns: cssCols }}>
          {Array.from({ length: cols }, (_, c) => (
            <Skeleton key={c} width={c === 0 ? "80%" : "50%"} height={14} />
          ))}
        </div>
      ))}
    </div>
  );
}

/** Grid of card placeholders (dashboard widgets, comparison cards). */
export function CardGridSkeleton({ cols = 3, rows = 2 }: { cols?: number; rows?: number }) {
  return (
    <div
      className={styles.skeletonCardGrid}
      style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
      aria-hidden="true"
    >
      {Array.from({ length: cols * rows }, (_, i) => (
        <div key={i} className={styles.skeletonCard}>
          <Skeleton width="45%" height={11} />
          <Skeleton width="80%" height={20} />
          <Skeleton width="100%" height={14} />
          <Skeleton width="65%" height={14} />
        </div>
      ))}
    </div>
  );
}

/** Paragraph placeholder — last line short, like real prose. */
export function TextBlockSkeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div style={{ display: "grid", gap: 8 }} aria-hidden="true">
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} width={i === lines - 1 ? "60%" : "100%"} height={13} />
      ))}
    </div>
  );
}

/** Soft-UI block placeholder — alias used by logistics / command loading shells. */
export function SoftBlockSkeleton({ lines = 3 }: { lines?: number }) {
  return <TextBlockSkeleton lines={lines} />;
}
