"use client";

import { Button } from "./ui";

import {
  scheduleRelatedLinks,
  type ScheduleRelatedId,
} from "../lib/schedule/schedule-related";

/** Soft-UI cross-links between Match Schedule and Calendar / Event Day / My Day. */
export function ScheduleRelated({
  orgId,
  active,
  include,
  className,
  ariaLabel = "Related schedule tools",
}: {
  orgId?: string | null;
  active?: ScheduleRelatedId;
  include?: ScheduleRelatedId[];
  className?: string;
  ariaLabel?: string;
}) {
  const links = scheduleRelatedLinks(orgId, { active, include });
  if (!links.length) return null;
  return (
    <nav
      className={["product-hub-related", "sched-related", className].filter(Boolean).join(" ")}
      aria-label={ariaLabel}
    >
      {links.map((link) => (
        <Button key={link.id} as="a" variant="secondary" href={link.href}>
          {link.label}
        </Button>
      ))}
    </nav>
  );
}
