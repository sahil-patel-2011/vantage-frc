"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useId, useState } from "react";
import { pushAppNavigation } from "../../lib/nav/soft-navigation";
import { ADMIN_FEEDBACK_NEW_EVENT, newFeedbackBadge } from "../../lib/feedback/admin-feedback";
import "./admin-feedback-badge.css";
import "./admin-console.css";
import { ADMIN_DESTINATIONS, MORE_PAGES, activeAdminDestination } from "../../lib/admin/admin-nav";
import { Icon } from "../../components/icon";

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
  const router = useRouter();
  const pickerId = useId();
  const active = activeAdminDestination(pathname);
  const currentTool = MORE_PAGES.find(page => pathname === page.href || pathname.startsWith(`${page.href}/`));
  const pickerValue = currentTool?.href ?? ADMIN_DESTINATIONS.find(dest => dest.id === active)?.href ?? "/admin";
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
      <p className="admin-console-label"><Icon name="shield" /> Platform admin</p>
      <label className="admin-console-picker" htmlFor={pickerId}>
        <span>Platform admin</span>
        <select id={pickerId} value={pickerValue} onChange={event => {
          const destination = [...ADMIN_DESTINATIONS, ...MORE_PAGES].find(item => item.href === event.target.value);
          if (destination) pushAppNavigation(path => router.push(path), destination.href);
        }}>
          <optgroup label="Manage Vantage">
            {ADMIN_DESTINATIONS.map(dest => <option key={dest.id} value={dest.href}>
              {dest.id === "more" ? "All admin tools" : dest.label}{dest.id === "feedback" && badge ? ` (${badge} new)` : ""}
            </option>)}
          </optgroup>
          <optgroup label="Other tools">
            {MORE_PAGES.map(page => <option key={page.href} value={page.href}>{page.label}</option>)}
          </optgroup>
        </select>
      </label>
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
            <Icon name={dest.id === "overview" ? "grid" : dest.id === "teams" ? "users" : dest.id === "ai-credits" ? "sparkles" : dest.id === "health" ? "activity" : dest.id === "feedback" ? "chat" : dest.id === "admins" ? "shield" : "gear"} />
            {dest.label}
            {dest.id === "feedback" ? <NewCount label={badge} /> : null}
          </a>
        );
      })}
    </nav>
  );
}
