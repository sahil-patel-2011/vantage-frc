"use client";

import { usePathname } from "next/navigation";
import { withOrgHref } from "../lib/nav/product-nav";

export type TeamOpsKey =
  | "start"
  | "practice"
  | "todos"
  | "messages"
  | "calendar"
  | "attendance"
  | "goals"
  | "batteries"
  | "admin";

const LINKS: Array<{ key: TeamOpsKey; href: string; label: string; match: (path: string) => boolean }> = [
  { key: "start", href: "/start", label: "Your path", match: (p) => p === "/start" || p.startsWith("/start/") },
  { key: "practice", href: "/practice", label: "Practice", match: (p) => p.startsWith("/practice") },
  {
    key: "todos",
    href: "/todos",
    label: "Todos",
    match: (p) => p.startsWith("/todos") || p.startsWith("/tasks"),
  },
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
    match: (p) =>
      (p === "/team" || p.startsWith("/team/")) &&
      !p.startsWith("/team/calendar") &&
      !p.startsWith("/team/knowledge") &&
      !p.startsWith("/team/getting-started"),
  },
];

type TeamOpsNavProps = {
  orgId?: string | null;
  /** Highlight this key even if the path is ambiguous (e.g. season calendar). */
  active?: TeamOpsKey;
  className?: string;
};

/**
 * Cross-links for Team + Calendar surfaces.
 * Keep in sync with Calendar / Team pillars in `lib/nav/product-nav.ts` and docs/FEATURE_MAP.md.
 */
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
            href={withOrgHref(link.href, orgId)}
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