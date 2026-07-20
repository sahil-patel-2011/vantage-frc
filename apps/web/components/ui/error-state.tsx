import type { ReactNode } from "react";
import { Badge } from "./badge";
import { Button } from "./button";
import styles from "./ui.module.css";

type ErrorStateProps = {
  title?: ReactNode;
  /** REAL error text (error.message / parsed API body) — never a bare boolean. */
  message?: ReactNode;
  /** Retry handler. If omitted, Retry defaults to a full reload so every error is recoverable. */
  onRetry?: () => void;
  retryLabel?: ReactNode;
  className?: string;
};

const WarnGlyph = () => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M12 3 22 20H2L12 3Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    <path d="M12 9.5v4.5M12 16.8v.1" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);

/**
 * Semantic error surface — distinct from the neutral setup EmptyState. Shows the REAL
 * captured message and ALWAYS renders a Retry (defaults to reload when no handler wired).
 */
export function ErrorState({
  title = "Something went wrong",
  message,
  onRetry,
  retryLabel = "Retry",
  className,
}: ErrorStateProps) {
  const retry =
    onRetry ??
    (() => {
      if (typeof window !== "undefined") window.location.reload();
    });
  return (
    <section
      role="alert"
      className={["app-card", "soft-panel", styles.errorState, className].filter(Boolean).join(" ")}
    >
      <span className={styles.errorGlyph}>
        <WarnGlyph />
      </span>
      <Badge tone="error">Error</Badge>
      <h2 style={{ margin: 0 }}>{title}</h2>
      {message != null && message !== "" ? <p className={styles.errorMessage}>{message}</p> : null}
      <Button variant="secondary" size="sm" onClick={retry}>
        {retryLabel}
      </Button>
    </section>
  );
}
