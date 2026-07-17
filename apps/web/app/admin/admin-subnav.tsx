"use client";

import { usePathname } from "next/navigation";

const links = [
  { href: "/admin", label: "Teams" },
  { href: "/admin/commercial", label: "Commercial" },
  { href: "/admin/connectors", label: "Connectors" },
  { href: "/admin/models", label: "Models" },
  { href: "/admin/sponsored", label: "Sponsored AI" },
  { href: "/admin/audit", label: "Audit log" },
] as const;

export function AdminSubnav() {
  const pathname = usePathname();
  return (
    <nav className="admin-subnav" aria-label="Platform admin">
      {links.map((link) => {
        const active = link.href === "/admin" ? pathname === "/admin" : pathname.startsWith(link.href);
        return (
          <a key={link.href} href={link.href} className={active ? "active" : undefined} aria-current={active ? "page" : undefined}>
            {link.label}
          </a>
        );
      })}
    </nav>
  );
}
