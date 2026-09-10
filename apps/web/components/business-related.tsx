"use client";

import { Button } from "./ui";

import {
  businessRelatedLinks,
  type BusinessRelatedId,
} from "../lib/business/business-related";

/** Soft-UI cross-links between Business sponsor CRM / packages / finance tools. */
export function BusinessRelated({
  orgId,
  active,
  include,
  className,
  ariaLabel = "Related business tools",
}: {
  orgId?: string | null;
  active?: BusinessRelatedId;
  include?: BusinessRelatedId[];
  className?: string;
  ariaLabel?: string;
}) {
  const links = businessRelatedLinks(orgId, { active, include });
  if (!links.length) return null;
  return (
    <nav
      className={["product-hub-related", "business-related", className].filter(Boolean).join(" ")}
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
