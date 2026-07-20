import type { ReactNode } from "react";
import styles from "./ui.module.css";

type Segment = { value: number; colorVar: string; label: string };

type ProgressMeterProps = {
  mode?: "determinate" | "indeterminate";
  value?: number;
  target?: number;
  unit?: string;
  label?: ReactNode;
  /** Live status line, e.g. "Generating strategy… up to 30s" or "Drafting section 2 of 4…". */
  status?: ReactNode;
  /** Stacked segments (e.g. costs by category); overrides value/target when present. */
  segments?: Segment[];
  /** empty → outline track + "Set a target to track progress". */
  state?: "configured" | "empty";
  className?: string;
};

/**
 * Progress affordance. Two jobs: (a) replace bare spinners on long AI ops with an
 * indeterminate bar + live status; (b) turn single-number progress into a labeled bar.
 * Threshold rule: fast CRUD → Skeleton; long meteredAI ops → this in indeterminate mode.
 */
export function ProgressMeter({
  mode = "determinate",
  value,
  target,
  unit,
  label,
  status,
  segments,
  state = "configured",
  className,
}: ProgressMeterProps) {
  const isEmpty = state === "empty";
  const isIndeterminate = mode === "indeterminate";
  const hasSegments = segments != null && segments.length > 0;

  const segTotal = hasSegments ? segments!.reduce((s, x) => s + x.value, 0) : 0;
  const denom = target && target > 0 ? target : hasSegments ? segTotal : 100;
  const pct = value != null && denom > 0 ? Math.min(100, Math.max(0, (value / denom) * 100)) : 0;

  const valueText = isIndeterminate
    ? "Working…"
    : value != null && target != null
      ? `${value}${unit ? ` ${unit}` : ""} of ${target}${unit ? ` ${unit}` : ""}`
      : value != null
        ? `${Math.round(pct)}%`
        : undefined;

  return (
    <div className={[styles.progressMeter, className].filter(Boolean).join(" ")}>
      {(label != null || valueText) && (
        <div className={styles.progressLabelRow}>
          {label != null ? <span className={styles.progressLabel}>{label}</span> : <span />}
          {valueText && !isEmpty ? <span className={styles.progressValue}>{valueText}</span> : null}
        </div>
      )}
      <div
        className={[styles.progressTrack, isEmpty ? styles.progressTrackEmpty : undefined]
          .filter(Boolean)
          .join(" ")}
        role="progressbar"
        aria-valuenow={isIndeterminate || isEmpty ? undefined : Math.round(pct)}
        aria-valuemin={isIndeterminate || isEmpty ? undefined : 0}
        aria-valuemax={isIndeterminate || isEmpty ? undefined : 100}
        aria-valuetext={isIndeterminate ? "In progress" : valueText}
        aria-label={typeof label === "string" ? label : undefined}
        aria-busy={isIndeterminate || undefined}
      >
        {isEmpty ? null : isIndeterminate ? (
          <span className={styles.progressIndeterminate} />
        ) : hasSegments ? (
          <div style={{ display: "flex", height: "100%", width: `${Math.min(100, (segTotal / denom) * 100)}%` }}>
            {segments!.map((seg, i) => (
              <span
                key={i}
                className={styles.progressSegment}
                title={`${seg.label}: ${seg.value}`}
                style={{
                  width: `${(seg.value / segTotal) * 100}%`,
                  background: seg.colorVar,
                }}
              />
            ))}
          </div>
        ) : (
          <span className={styles.progressFill} style={{ width: `${pct}%` }} />
        )}
      </div>
      {isEmpty ? (
        <p className={styles.progressStatus}>Set a target to track progress</p>
      ) : status != null ? (
        <p className={styles.progressStatus} aria-live="polite">
          {status}
        </p>
      ) : null}
    </div>
  );
}
