"use client";

import { usePathname } from "next/navigation";
import { withOrgHref } from "../lib/nav/product-nav";

export type TeamOpsKey =
  | "start" | "practice" | "todos" | "messages" | "calendar" | "attendance" | "knowledge" | "logistics" | "goals" | "batteries" | "fmea" | "admin";

const LINKS: Array<{ key: TeamOpsKey; href: string; label: string; match: (path: string) => boolean }> = [
  { key: "start", href: "/start", label: "Your path", match: (p) => p === "/start" || p.startsWith("/start/") },
  { key: "practice", href: "/team?tab=practice", label: "Practice", match: (p) => p.startsWith("/practice") },
  { key: "todos", href: "/team?tab=todos", label: "Todos", match: (p) => p.startsWith("/todos") || p.startsWith("/tasks") },
  { key: "messages", href: "/team?tab=messages", label: "Messages", match: (p) => p.startsWith("/messages") },
  { key: "calendar", href: "/team?tab=calendar", label: "Calendar", match: (p) => p.startsWith("/team/calendar") || p === "/calendar" },
  { key: "attendance", href: "/team?tab=attendance", label: "Attendance", match: (p) => p.startsWith("/attendance") },
  { key: "knowledge", href: "/team?tab=knowledge", label: "Knowledge", match: (p) => p.startsWith("/team/knowledge") || p.startsWith("/knowledge") },
  { key: "logistics", href: "/logistics", label: "Logistics", match: (p) => p.startsWith("/logistics") || p.startsWith("/travel") },
  { key: "goals", href: "/goals", label: "Goals", match: (p) => p.startsWith("/goals") },
  { key: "batteries", href: "/team?tab=batteries", label: "Batteries", match: (p) => p.startsWith("/batteries") },
  { key: "fmea", href: "/team?tab=fmea", label: "FMEA", match: (p) => p.startsWith("/fmea") },
  { key: "admin", href: "/team/admin", label: "Admin", match: (p) => p === "/team/admin" || p.startsWith("/team/admin/") },
];

/** Page-scoped strips — avoid dumping every TeamOps pill on Logistics / Calendar / Background. */
const CONTEXT_KEYS: Partial<Record<TeamOpsKey, TeamOpsKey[]>> = {
  logistics: ["logistics", "calendar", "attendance", "practice"],
  calendar: ["calendar", "practice", "attendance", "messages", "logistics"],
  admin: ["admin", "start", "messages"],
};

type TeamOpsNavProps = {
  orgId?: string | null;
  active?: TeamOpsKey;
  /** Limit which keys appear; defaults to a focused set when `active` has a context map. */
  keys?: TeamOpsKey[];
  className?: string;
};

export function TeamOpsNav({ orgId, active, keys, className }: TeamOpsNavProps) {
  const pathname = usePathname() || "";
  const allow = keys ?? (active ? CONTEXT_KEYS[active] : undefined);
  const links = allow ? LINKS.filter((link) => allow.includes(link.key)) : LINKS;

  return (
    <nav className={["team-ops-nav", className].filter(Boolean).join(" ")} aria-label="Team operations">
      {links.map((link) => {
        const selected = active ? link.key === active : link.match(pathname);
        return (
          <a key={link.key} href={withOrgHref(link.href, orgId)} className={selected ? "active" : undefined} aria-current={selected ? "page" : undefined}>
            {link.label}
          </a>
        );
      })}
    </nav>
  );
}
