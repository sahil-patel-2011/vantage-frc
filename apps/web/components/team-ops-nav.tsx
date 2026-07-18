"use client";

import { usePathname } from "next/navigation";

export type TeamOpsKey =
  | "practice"
  | "todos"
  | "messages"
  | "calendar"
  | "attendance"
  | "goals"
  | "batteries"
  | "admin";

const LINKS: Array<{ key: TeamOpsKey; href: string; label: string; match: (path: string) => boolean }> = [
  { key: "practice", href: "/practice", label: "Practice", match: (p) => p.startsWith("/practice") },
  { key: "todos", href: "/tasks", label: "Todos", match: (p) => p.startsWith("/tasks") },
  { key: "messages", href: "/messages", label: "Messages", match: (p) => p.startsWith("/messages") },
  {
    key: "calendar",
    href: "/team/calendar",
    label: "Calendar",
    match: (p) => p.startsWith("/team/calendar") || p === "/calendar",
  },
  { key: "attendance", href: "/attendance", label: "Attendance", match: (p) => p.startsWith("/attendance") },
  { key: "goals", href: "/goals", label: "Goals", match: (p) => p.startsWith("/goals") },
  { key: "batteries", href: "/batteries", label: "Batteries", match: (p) => p.startsWith("/batteries") },
  {
    key: "admin",
    href: "/team",
    label: "Admin",
    match: (p) => (p === "/team" || p.startsWith("/team/")) && !p.startsWith("/team/calendar"),
  },
];

function withOrg(href: string, orgId?: string | null) {
  if (!orgId) return href;
  const join = href.includes("?") ? "&" : "?";
  return `${href}${join}orgId=${encodeURIComponent(orgId)}`;
}

type TeamOpsNavProps = {
  orgId?: string | null;
  /** Highlight this key even if the path is ambiguous (e.g. season calendar). */
  active?: TeamOpsKey;
  className?: string;
};

/** Cross-links for Team ops surfaces — Practice / Todos / Messages / Calendar first. */
export function TeamOpsNav({ orgId, active, className }: TeamOpsNavProps) {
  const pathname = usePathname() || "";
  return (
    <nav
      className={["team-ops-nav", className].filter(Boolean).join(" ")}
      aria-label="Team operations"
    >
      {LINKS.map((link) => {
        const selected = active ? link.key === active : link.match(pathname);
        return (
          <a
            key={link.key}
            href={withOrg(link.href, orgId)}
            className={selected ? "active" : undefined}
            aria-current={selected ? "page" : undefined}
          >
            {link.label}
          </a>
        );
      })}
    </nav>
  );
}
