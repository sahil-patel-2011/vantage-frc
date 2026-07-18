"use client";

import {
  teamHubRelatedLinks,
  type TeamHubRelatedId,
} from "../lib/team/team-related";

export type { TeamHubRelatedId };

/** Soft-UI cross-links between Team hub surfaces (and Build tools hosted on the hub). */
export function TeamHubRelated({
  orgId,
  active,
  include,
  className,
  ariaLabel = "Related team tools",
}: {
  orgId?: string | null;
  active?: TeamHubRelatedId;
  /** When set, only these surfaces appear (still excludes `active`). */
  include?: TeamHubRelatedId[];
  className?: string;
  ariaLabel?: string;
}) {
  const links = teamHubRelatedLinks(orgId, { active, include });
  if (!links.length) return null;
  return (
    <nav
      className={["product-hub-related", "team-hub-related", className].filter(Boolean).join(" ")}
      aria-label={ariaLabel}
    >
      {links.map((link) => (
        <a key={link.id} className="app-button secondary" href={link.href}>
          {link.label}
        </a>
      ))}
    </nav>
  );
}
