"use client";

import { Button } from "./ui";

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
        <Button key={link.id} as="a" variant="secondary" href={link.href}>
          {link.label}
        </Button>
      ))}
    </nav>
  );
}
