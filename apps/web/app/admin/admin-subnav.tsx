"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { ADMIN_FEEDBACK_NEW_EVENT, newFeedbackBadge } from "../../lib/feedback/admin-feedback";
import "./admin-feedback-badge.css";

/**
 * Platform admin navigation.
 *
 * This was fourteen links in one flat row — every destination in the area shown
 * at once, on every page, whether or not it had anything to do with what you
 * were doing. You read the whole row to find one item.
 *
 * They are four jobs, so they are four tabs: who is on the platform, what data
 * it holds, what is running, and what it costs. Only the open group's links are
 * on screen, which takes the row from fourteen controls to four plus the three
 * or four that belong to where you are.
 */
const GROUPS = [
  {
    id: "workspace",
    label: "Workspace",
    links: [
      { href: "/admin", label: "Teams" },
      { href: "/admin/partners", label: "Partners" },
      { href: "/admin/outreach", label: "Outreach" },
      { href: "/admin/support", label: "Support" },
    ],
  },
  {
    id: "data",
    label: "Data",
    links: [
      { href: "/admin/analytics", label: "Analytics" },
      { href: "/admin/waitlist", label: "Waitlist" },
      // People telling us things, next to the waitlist: both are inboxes someone has to read.
      { href: "/admin/feedback", label: "Feedback" },
      { href: "/admin/audit", label: "Audit log" },
    ],
  },
  {
    id: "operations",
    label: "Operations",
    links: [
      { href: "/admin/connectors", label: "Connectors" },
      { href: "/admin/integrations", label: "Integrations" },
      { href: "/admin/models", label: "Models" },
      { href: "/admin/sponsored", label: "Sponsored AI" },
    ],
  },
  {
    id: "settings",
    label: "Settings",
    links: [
      { href: "/admin/plans", label: "Plans" },
      { href: "/admin/commercial", label: "Commercial" },
      { href: "/admin/releases", label: "Releases" },
    ],
  },
] as const;

const FEEDBACK_HREF = "/admin/feedback";

/** `/admin` is only Teams; every other entry owns its own subtree. */
function linkIsActive(pathname: string, href: string): boolean {
  return href === "/admin" ? pathname === "/admin" : pathname.startsWith(href);
}

/**
 * The group holding the current page. Falls back to the first group so the row
 * is never blank on a route that has not been filed yet — a admin page with no
 * navigation at all is worse than one showing the wrong tab.
 */
export function activeAdminGroup(pathname: string) {
  return (
    GROUPS.find((group) => group.links.some((link) => linkIsActive(pathname, link.href))) ?? GROUPS[0]
  );
}

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
 * number again whenever the operator changes a status, so the tabs never show a stale one.
 */
export function AdminSubnav({ newFeedback = null }: { newFeedback?: number | null }) {
  const pathname = usePathname();
  const active = activeAdminGroup(pathname);
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
    <div className="admin-nav">
      <nav className="admin-tabs" aria-label="Platform admin sections">
        {GROUPS.map((group) => {
          const isOpen = group.id === active.id;
          return (
            <a
              key={group.id}
              // The tab leads to the first page in its group, so opening a tab
              // takes you somewhere rather than only changing what is listed.
              href={group.links[0].href}
              className={isOpen ? "is-open" : undefined}
              aria-current={isOpen ? "true" : undefined}
            >
              {group.label}
              {/* New feedback is waiting inside this tab: say so from any other tab. */}
              {!isOpen && group.links.some((link) => link.href === FEEDBACK_HREF) ? <NewCount label={badge} /> : null}
            </a>
          );
        })}
      </nav>
      <nav className="admin-subnav" aria-label={`${active.label} pages`}>
        {active.links.map((link) => {
          const isActive = linkIsActive(pathname, link.href);
          return (
            <a
              key={link.href}
              href={link.href}
              className={isActive ? "active" : undefined}
              aria-current={isActive ? "page" : undefined}
            >
              {link.label}
              {link.href === FEEDBACK_HREF ? <NewCount label={badge} /> : null}
            </a>
          );
        })}
      </nav>
    </div>
  );
}
