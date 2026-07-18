"use client";

import { hubHref } from "../lib/nav/hubs";

const LINKS = [
  { id: "calendar", label: "Calendar & subteams" },
  { id: "practice", label: "Practice" },
  { id: "attendance", label: "Attendance" },
  { id: "knowledge", label: "Knowledge" },
  { id: "messages", label: "Messages" },
  { id: "todos", label: "Todos" },
  { id: "batteries", label: "Batteries" },
  { id: "fmea", label: "FMEA" },
] as const;

export type TeamHubRelatedId = (typeof LINKS)[number]["id"];

/** Soft-UI cross-links between Team hub surfaces (and Build tools hosted on the hub). */
export function TeamHubRelated({
  orgId,
  active,
  className,
}: {
  orgId?: string | null;
  active?: TeamHubRelatedId;
  className?: string;
}) {
  return (
    <nav
      className={["product-hub-related", "team-hub-related", className].filter(Boolean).join(" ")}
      aria-label="Related team tools"
    >
      {LINKS.map((link) => {
        if (link.id === active) return null;
        return (
          <a key={link.id} className="app-button secondary" href={hubHref("/team", link.id, orgId)}>
            {link.label}
          </a>
        );
      })}
    </nav>
  );
}
