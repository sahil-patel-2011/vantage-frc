"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { ADMIN_FEEDBACK_NEW_EVENT, newFeedbackBadge } from "../../lib/feedback/admin-feedback";
import "./admin-feedback-badge.css";
import "./admin-console.css";
import { ADMIN_DESTINATIONS, activeAdminDestination } from "../../lib/admin/admin-nav";

export { ADMIN_DESTINATIONS, MORE_PAGES, activeAdminDestination, type AdminDestinationId } from "../../lib/admin/admin-nav";

/** A quiet count after a label, with a spoken form so a screen reader hears "3 new". */
function NewCount({ label }: { label: string }) {
  if (!label) return null;
  return (
    <span className="admin-new-count" aria-label={`${label} new`}>
      {label}
    </span>
  );
}

/**
 * `newFeedback` is what the layout counted on the server; the Feedback page announces the
 * number again whenever the operator changes a status, so the row never shows a stale one.
 */
export function AdminSubnav({ newFeedback = null }: { newFeedback?: number | null }) {
  const pathname = usePathname();
  const active = activeAdminDestination(pathname);
  const [feedbackNew, setFeedbackNew] = useState<number | null>(newFeedback);

  useEffect(() => {
    setFeedbackNew(newFeedback);
  }, [newFeedback]);

  useEffect(() => {
    const onCount = (event: Event) => {
      const count = (event as CustomEvent<{ count?: number }>).detail?.count;
      if (typeof count === "number") setFeedbackNew(count);
    };
    window.addEventListener(ADMIN_FEEDBACK_NEW_EVENT, onCount);
    return () => window.removeEventListener(ADMIN_FEEDBACK_NEW_EVENT, onCount);
  }, []);

  const badge = newFeedbackBadge(feedbackNew);

  return (
    <nav className="admin-console-nav" aria-label="Platform admin">
      {ADMIN_DESTINATIONS.map((dest) => {
        const isActive = dest.id === active;
        return (
          <a
            key={dest.id}
            href={dest.href}
            className={isActive ? "is-active" : undefined}
            aria-current={isActive ? "page" : undefined}
            data-quiet={dest.id === "more" || undefined}
          >
            {dest.label}
            {dest.id === "feedback" ? <NewCount label={badge} /> : null}
          </a>
        );
      })}
    </nav>
  );
}
