"use client";

import { Button } from "./ui";

import {
  competitionRelatedLinks,
  type CompetitionRelatedId,
} from "../lib/strategy/competition-related";

/** Soft-UI cross-links between Competition Strategy / scouting / pick surfaces. */
export function CompetitionHubRelated({
  orgId,
  active,
  include,
  className,
  ariaLabel = "Related competition tools",
}: {
  orgId?: string | null;
  active?: CompetitionRelatedId;
  include?: CompetitionRelatedId[];
  className?: string;
  ariaLabel?: string;
}) {
  const links = competitionRelatedLinks(orgId, { active, include });
  if (!links.length) return null;
  return (
    <nav
      className={["product-hub-related", "competition-hub-related", className].filter(Boolean).join(" ")}
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
