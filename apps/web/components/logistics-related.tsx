"use client";

import { Button } from "./ui";

import {
  LOGISTICS_RELATED_INCLUDE,
  logisticsRelatedLinks,
  type LogisticsRelatedId,
} from "../lib/logistics/logistics-related";

/** Soft-UI cross-links between Logistics and Event Day / My Day / Calendar / Packing / Visit invites. */
export function LogisticsRelated({
  orgId,
  active,
  include = [...LOGISTICS_RELATED_INCLUDE],
  className,
  ariaLabel = "Related logistics tools",
}: {
  orgId?: string | null;
  active?: LogisticsRelatedId;
  include?: LogisticsRelatedId[];
  className?: string;
  ariaLabel?: string;
}) {
  const links = logisticsRelatedLinks(orgId, { active, include });
  if (!links.length) return null;
  return (
    <nav
      className={["product-hub-related", "logistics-related", className].filter(Boolean).join(" ")}
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
