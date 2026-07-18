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
  "aria-busy": ariaBusy,
}: EmptyStateProps) {
  const shell = soft ? "soft-empty" : "app-card soft-panel";
  return (
    <section className={[shell, className].filter(Boolean).join(" ")} aria-busy={ariaBusy}>
      {badge != null && badge !== "" ? (
        <span className={["app-badge", badgeTone].filter(Boolean).join(" ")}>{badge}</span>
      ) : null}
      <h2>{title}</h2>
      {description ? <p className="app-muted">{description}</p> : null}
      {children}
    </section>
  );
}
