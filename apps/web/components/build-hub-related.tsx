"use client";

import {
  buildRelatedLinks,
  type BuildRelatedId,
} from "../lib/build/build-related";

/** Soft-UI cross-links between Build hub surfaces and Competition / AI. */
export function BuildHubRelated({
  orgId,
  active,
  include,
  className,
  ariaLabel = "Related build tools",
}: {
  orgId?: string | null;
  active?: BuildRelatedId;
  include?: BuildRelatedId[];
  className?: string;
  ariaLabel?: string;
}) {
  const links = buildRelatedLinks(orgId, { active, include });
  if (!links.length) return null;
  return (
    <nav
      className={["product-hub-related", "build-hub-related", className].filter(Boolean).join(" ")}
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
