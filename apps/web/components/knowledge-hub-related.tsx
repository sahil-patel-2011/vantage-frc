"use client";

import {
  knowledgeRelatedLinks,
  type KnowledgeRelatedId,
} from "../lib/knowledge/knowledge-related";

/** Soft-UI cross-links between Knowledge and Messages / FMEA / CAD. */
export function KnowledgeHubRelated({
  orgId,
  active,
  include,
  className,
  ariaLabel = "Related knowledge tools",
}: {
  orgId?: string | null;
  active?: KnowledgeRelatedId;
  include?: KnowledgeRelatedId[];
  className?: string;
  ariaLabel?: string;
}) {
  const links = knowledgeRelatedLinks(orgId, { active, include });
  if (!links.length) return null;
  return (
    <nav
      className={["product-hub-related", "knowledge-hub-related", className].filter(Boolean).join(" ")}
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
