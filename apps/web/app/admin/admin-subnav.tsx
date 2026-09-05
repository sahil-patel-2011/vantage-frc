"use client";

import { usePathname } from "next/navigation";
import "../../components/settings-bar.css";

const GROUPS = [
  {
    id: "workspace",
    label: "Workspace",
    items: [
      { href: "/admin", label: "Teams" },
      { href: "/admin/analytics", label: "Analytics" },
      { href: "/admin/audit", label: "Audit log" },
    ],
  },
  {
    id: "growth",
    label: "Growth",
    items: [
      { href: "/admin/waitlist", label: "Waitlist" },
      { href: "/admin/partners", label: "Partners" },
      { href: "/admin/outreach", label: "Outreach" },
      { href: "/admin/plans", label: "Plans" },
      { href: "/admin/releases", label: "Releases" },
      { href: "/admin/commercial", label: "Commercial" },
    ],
  },
  {
    id: "ai",
    label: "AI",
    items: [
      { href: "/admin/connectors", label: "Connectors" },
      { href: "/admin/integrations", label: "Integrations" },
      { href: "/admin/models", label: "Models" },
      { href: "/admin/sponsored", label: "Sponsored AI" },
      { href: "/admin/ai-grants", label: "AI tokens" },
      { href: "/admin/free-relay", label: "FreeBuff Pis" },
    ],
  },
  {
    id: "ops",
    label: "Ops",
    items: [{ href: "/admin/support", label: "Support" }],
  },
] as const;

function isActive(pathname: string, href: string) {
  return href === "/admin" ? pathname === "/admin" : pathname.startsWith(href);
}

export function AdminSubnav() {
  const pathname = usePathname();

  return (
    <nav className="admin-subnav tesla-settings" aria-label="Platform admin">
      <div className="settings-bar-group">
        {GROUPS.map((group) => {
          const activeItem = group.items.find((item) => isActive(pathname, item.href));
          return activeItem ? (
            <a key={group.id} href={activeItem.href} className="settings-bar-row is-active" aria-current="page">
              {group.label}: {activeItem.label}
            </a>
          ) : null;
        })}
      </div>
      <details className="admin-subnav-more">
        <summary>Browse admin sections</summary>
        {GROUPS.map((group) => (
          <div key={group.id} className="settings-bar-group" role="group" aria-label={group.label}>
            <span className="settings-bar-group-label">{group.label}</span>
            {group.items.map((item) => {
              const active = isActive(pathname, item.href);
              return (
                <a key={item.href} href={item.href} className={`settings-bar-row${active ? " is-active" : ""}`} aria-current={active ? "page" : undefined}>
                  {item.label}
                </a>
              );
            })}
          </div>
        ))}
      </details>
    </nav>
  );
}
