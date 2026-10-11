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

/** A title that says nothing ("Something went wrong") gives way to the diagnosis. */
const OLD_CATCH_ALL = /^\s*something went wrong\.?\s*$/i;

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

  // An explicit title from the caller still wins, unless it is the old catch-all, which says
  // nothing the diagnosis cannot say better.
  const heading = title != null && !OLD_CATCH_ALL.test(String(title)) ? title : copy.title;
  // A string message is used through the diagnosis, which shows it only when it is a sentence a
  // person can use: "signal timed out" (the browser's AbortSignal text) was printed as the whole
  // explanation on Money under load. A caller-built element is shown as given.
  const body =
    message != null && message !== "" && typeof message !== "string" && kind === "unknown"
      ? message
      : copy.description;

  // A session that expired, a network that dropped or slowed, a page this member may not
  // open: all recoverable, none of them a failure of the product. Painting them
  // in the danger colour — a red hairline and a red plate — told a team their
  // data was broken when the only thing wrong was that they were signed out.
  const severity =
    kind === "auth" || kind === "forbidden" || kind === "offline" || kind === "slow" ? "notice" : "error";

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
        {copy.badge}
      </Badge>
      <h2 style={{ margin: 0 }}>{heading}</h2>
      {body != null && body !== "" ? <p className={styles.errorMessage}>{body}</p> : null}
      <div className={styles.errorActions}>
        {copy.primary ? (
          <Button as="a" variant="primary" href={copy.primary.href}>
            {copy.primary.label}
          </Button>
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
