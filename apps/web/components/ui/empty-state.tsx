import type { ReactNode } from "react";

type BadgeTone = "setup" | "good" | "demo" | "";

type EmptyStateProps = {
  title: ReactNode;
  description?: ReactNode;
  badge?: ReactNode;
  badgeTone?: BadgeTone;
  children?: ReactNode;
  className?: string;
  /** Use dashed soft-empty shell instead of a raised soft-panel. */
  soft?: boolean;
  /**
   * Inline variant with no border/background/padding of its own — for a slot that
   * already lives inside a chromed card (e.g. a dashboard widget), where a nested
   * `app-card`/`soft-empty` box would double the border. Takes over `soft`.
   */
  compact?: boolean;
  /**
   * 1 when the empty state *is* the page — a 404, a paused tool — and nothing
   * above it is the page's main heading. Defaults to 2, the right level inside
   * a page that already has a title. A page with no h1 at all gives a screen
   * reader nothing to announce as where you are.
   */
  headingLevel?: 1 | 2;
  "aria-busy"?: boolean;
};

/** Shared Soft-UI empty / loading / setup shell. */
export function EmptyState({
  title,
  description,
  badge,
  badgeTone = "",
  children,
  className,
  soft = false,
  compact = false,
  headingLevel = 2,
  "aria-busy": ariaBusy,
}: EmptyStateProps) {
  const shell = compact ? "soft-empty-compact" : soft ? "soft-empty scan-empty" : "app-card soft-panel scan-empty";
  return (
    <section className={[shell, className].filter(Boolean).join(" ")} aria-busy={ariaBusy}>
      {badge != null && badge !== "" ? (
        <span className={["app-badge", badgeTone].filter(Boolean).join(" ")}>{badge}</span>
      ) : null}
      {headingLevel === 1 ? <h1>{title}</h1> : <h2>{title}</h2>}
      {description ? <p className="app-muted">{description}</p> : null}
      {children}
    </section>
  );
}
