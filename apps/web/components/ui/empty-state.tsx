import type { ReactNode } from "react";

type BadgeTone = "setup" | "good" | "demo" | "error" | "";

/**
 * A failure badge ("Unavailable", "Couldn't load") stamped with the setup tone read exactly like
 * "Needs setup": the same beige for "you have something to do" and "we broke". Those words get
 * the error tone whatever the caller passed.
 */
const FAILURE_BADGE = /^(unavailable|error|failed|offline|not found|run failed|couldn.?t|could not|can.?t (load|reach))/i;

/** The class for a status badge whose words come from a copy table: red for a failure. */
export function statusBadgeClass(badge: ReactNode): string {
  return `app-badge ${emptyStateBadgeTone(badge, "setup")}`;
}

export function emptyStateBadgeTone(badge: ReactNode, tone: BadgeTone): BadgeTone {
  if ((tone === "setup" || tone === "") && typeof badge === "string" && FAILURE_BADGE.test(badge.trim())) return "error";
  return tone;
}

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
    // A loading card ("Opening your team…") is a status: without the role, the change from
    // loading to loaded was silent to a screen reader on Business, Tasks, Team and Pit.
    <section className={[shell, className].filter(Boolean).join(" ")} aria-busy={ariaBusy} role={ariaBusy ? "status" : undefined}>
      {badge != null && badge !== "" ? (
        <span className={["app-badge", emptyStateBadgeTone(badge, badgeTone)].filter(Boolean).join(" ")}>{badge}</span>
      ) : null}
      {headingLevel === 1 ? <h1>{title}</h1> : <h2>{title}</h2>}
      {description ? <p className="app-muted">{description}</p> : null}
      {children}
    </section>
  );
}
