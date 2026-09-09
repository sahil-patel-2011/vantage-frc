"use client";

import type { ReactNode } from "react";
import { Badge } from "./badge";
import { Button } from "./button";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";
import styles from "./ui.module.css";

type ErrorStateProps = {
  title?: ReactNode;
  /** REAL error text (error.message / parsed API body) — never a bare boolean. */
  message?: ReactNode;
  /** Retry handler. If omitted, Retry defaults to a full reload so every error is recoverable. */
  onRetry?: () => void;
  retryLabel?: ReactNode;
  className?: string;
  /** HTTP status from the failed request, when the caller kept it. */
  status?: number | null;
};

const WarnGlyph = () => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M12 3 22 20H2L12 3Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    <path d="M12 9.5v4.5M12 16.8v.1" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);

/**
 * Semantic error surface — distinct from the neutral setup EmptyState.
 *
 * The recovery action is chosen from the failure itself: an expired session
 * offers "Sign in again" instead of a Retry that can never succeed, and a
 * permissions failure says so rather than pretending it is a transient error.
 * Callers that pass only a message still benefit, because the message text is
 * classified when no status was kept.
 */
export function ErrorState({
  title,
  message,
  onRetry,
  retryLabel = "Retry",
  className,
  status,
}: ErrorStateProps) {
  const messageText = typeof message === "string" ? message : null;
  const online = typeof navigator === "undefined" ? true : navigator.onLine;
  const kind = classifyLoadFailure({ status, message: messageText, online });
  const nextPath =
    typeof window === "undefined" ? null : `${window.location.pathname}${window.location.search}`;
  const copy = loadFailureCopy(kind, { nextPath, message: messageText });

  const retry =
    onRetry ??
    (() => {
      if (typeof window !== "undefined") window.location.reload();
    });

  // An explicit title from the caller still wins; otherwise use the diagnosis.
  const heading = title ?? copy.title;
  // Only replace the caller's message when we have something more useful to say.
  const body =
    message != null && message !== "" && kind === "unknown" ? message : copy.description;

  // A session that expired, a network that dropped, a page this member may not
  // open: all recoverable, none of them a failure of the product. Painting them
  // in the danger colour — a red hairline and a red plate — told a team their
  // data was broken when the only thing wrong was that they were signed out.
  const severity = kind === "auth" || kind === "forbidden" || kind === "offline" ? "notice" : "error";

  return (
    <section
      role="alert"
      data-severity={severity}
      className={["app-card", "soft-panel", styles.errorState, className].filter(Boolean).join(" ")}
    >
      <span className={styles.errorGlyph}>
        <WarnGlyph />
      </span>
      {/* icon={null}: the glyph above is already this state's warning mark, and
          the badge's own glyph made two of them, stacked, saying one thing. */}
      <Badge tone={severity === "notice" ? "setup" : "error"} icon={null}>
        {kind === "auth" ? "Signed out" : kind === "forbidden" ? "No access" : kind === "offline" ? "Offline" : "Error"}
      </Badge>
      <h2 style={{ margin: 0 }}>{heading}</h2>
      {body != null && body !== "" ? <p className={styles.errorMessage}>{body}</p> : null}
      <div className={styles.errorActions}>
        {copy.primary ? (
          <a className="app-button" href={copy.primary.href}>
            {copy.primary.label}
          </a>
        ) : null}
        {copy.showRetry ? (
          <Button variant="secondary" size="sm" onClick={retry}>
            {retryLabel}
          </Button>
        ) : null}
      </div>
    </section>
  );
}
