"use client";

import type { ReactNode } from "react";
import { receiptLine, type ReceiptStatus } from "../../lib/scouting/sync-receipt";
import { signInHref } from "../../lib/ui/load-failure";

/**
 * The card after Save on the quick pit and match screens. The tick and "Sent to your team."
 * appear only once the server has this entry; until then it says where the entry is (on this
 * phone) and the one thing that helps: wait for signal, try now, sign in again, or read why
 * the team refused it.
 */
export function SaveReceipt({
  title,
  status,
  needsALookHref,
  onRetry,
  children,
}: {
  title: string;
  status: ReceiptStatus;
  /** Where entries the server set aside are listed, with Retry and Discard. */
  needsALookHref: string;
  onRetry(): void;
  /** The "Next" button. */
  children?: ReactNode;
}) {
  const line = receiptLine(status);
  const here = typeof window === "undefined" ? null : `${window.location.pathname}${window.location.search}`;
  return (
    <section className={`qs-receipt is-${line.tone}`} role="status" aria-live="polite">
      <span className="qs-receipt-check" aria-hidden="true">
        {line.tone === "done" ? "✓" : line.tone === "problem" ? "!" : "…"}
      </span>
      <div>
        <strong>{title}</strong>
        <span>{line.text}</span>
        {status.sync === "unreachable" || status.sync === "queued" ? (
          <button type="button" className="qs-link qs-receipt-action" onClick={onRetry}>
            Try again now
          </button>
        ) : status.sync === "signed-out" ? (
          <a className="qs-link qs-receipt-action" href={signInHref(here)}>
            Sign in again
          </a>
        ) : status.sync === "refused" ? (
          <a className="qs-link qs-receipt-action" href={needsALookHref}>
            See what to do
          </a>
        ) : null}
      </div>
      {children}
    </section>
  );
}
