"use client";

import { Button } from "./ui";

import {
  displayRelatedLinks,
  type DisplayRelatedId,
} from "../lib/display/display-related";

/** Soft-UI cross-links between Displays and Event Day / Strategy / Scouting. */
export function DisplayRelated({
  orgId,
  active,
  include,
  className,
  ariaLabel = "Related competition tools",
}: {
  orgId?: string | null;
  active?: DisplayRelatedId;
  include?: DisplayRelatedId[];
  className?: string;
  ariaLabel?: string;
}) {
  const links = displayRelatedLinks(orgId, { active, include });
  if (!links.length) return null;
  return (
    <nav
      className={["product-hub-related", "display-related", className].filter(Boolean).join(" ")}
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
