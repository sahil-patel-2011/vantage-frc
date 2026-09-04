"use client";

import { useEffect, useMemo, useState } from "react";
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

type GroupId = (typeof GROUPS)[number]["id"];

function isActive(pathname: string, href: string) {
  return href === "/admin" ? pathname === "/admin" : pathname.startsWith(href);
}

function groupFromPath(pathname: string): GroupId {
  for (const group of GROUPS) {
    if (group.items.some((item) => isActive(pathname, item.href))) return group.id;
  }
  return "workspace";
}

export function AdminSubnav() {
  const pathname = usePathname();
  const [query, setQuery] = useState("");
  const [groupId, setGroupId] = useState<GroupId>(() => groupFromPath(pathname));
  useEffect(() => {
    setGroupId(groupFromPath(pathname));
  }, [pathname]);
  const activeGroup = GROUPS.some((group) => group.id === groupId) ? groupId : groupFromPath(pathname);

  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const scoped = needle ? GROUPS : GROUPS.filter((group) => group.id === activeGroup);
    return scoped
      .map((group) => ({
        ...group,
        items: group.items.filter((item) => !needle || item.label.toLowerCase().includes(needle)),
      }))
      .filter((group) => group.items.length > 0);
  }, [activeGroup, query]);

  return (
    <nav className="admin-subnav tesla-settings" aria-label="Platform admin">
      <div className="admin-subnav-groups" role="tablist" aria-label="Admin sections">
        {GROUPS.map((group) => {
          const selected = group.id === activeGroup && !query.trim();
          return (
            <button
              key={group.id}
              type="button"
              role="tab"
              aria-selected={selected}
              className={selected ? "is-active" : undefined}
              onClick={() => {
                setGroupId(group.id);
                setQuery("");
              }}
            >
              {group.label}
            </button>
          );
        })}
      </div>
      <label className="settings-bar-search">
        <span className="visually-hidden">Search admin</span>
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search admin"
        />
      </label>
      {groups.map((group) => (
        <div key={group.id} className="settings-bar-group" role="group" aria-label={group.label}>
          {query.trim() ? <span className="settings-bar-group-label">{group.label}</span> : null}
          {group.items.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <a
                key={item.href}
                href={item.href}
                className={`settings-bar-row${active ? " is-active" : ""}`}
                aria-current={active ? "page" : undefined}
              >
                {item.label}
              </a>
            );
          })}
        </div>
      ))}
      {groups.length === 0 ? <p className="settings-bar-empty">Nothing matches.</p> : null}
    </nav>
  );
}
