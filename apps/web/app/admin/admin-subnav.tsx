"use client";

import { usePathname } from "next/navigation";

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

export function AdminSubnav() {
  const pathname = usePathname();
  const active = activeAdminGroup(pathname);

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
            </a>
          );
        })}
      </nav>
    </div>
  );
}
