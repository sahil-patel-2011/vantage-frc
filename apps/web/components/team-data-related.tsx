"use client";

import { Button } from "./ui";

import {
  teamDataRelatedLinks,
  type TeamDataRelatedId,
} from "../lib/team-data/team-data-related";

/** Soft-UI cross-links between Team Data and Schedule / Event Day / Strategy. */
export function TeamDataRelated({
  orgId,
  active,
  include,
  className,
  ariaLabel = "Related team data tools",
}: {
  orgId?: string | null;
  active?: TeamDataRelatedId;
  include?: TeamDataRelatedId[];
  className?: string;
  ariaLabel?: string;
}) {
  const links = teamDataRelatedLinks(orgId, { active, include });
  if (!links.length) return null;
  return (
    <nav
      className={["product-hub-related", "team-data-related", className].filter(Boolean).join(" ")}
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
