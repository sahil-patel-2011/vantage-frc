"use client";

import { Button } from "./ui";

import {
  visitRelatedLinks,
  type VisitRelatedId,
} from "../lib/visit-invites/visit-related";

/** Soft-UI cross-links between Visit Invites and Logistics / Event Day / Calendar. */
export function VisitRelated({
  orgId,
  active,
  include,
  className,
  ariaLabel = "Related visit invite tools",
}: {
  orgId?: string | null;
  active?: VisitRelatedId;
  include?: VisitRelatedId[];
  className?: string;
  ariaLabel?: string;
}) {
  const links = visitRelatedLinks(orgId, { active, include });
  if (!links.length) return null;
  return (
    <nav
      className={["product-hub-related", "visit-related", className].filter(Boolean).join(" ")}
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
