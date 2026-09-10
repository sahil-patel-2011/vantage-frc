"use client";

import { Button } from "../../components/ui";
import { MEDIA_RELATED_INCLUDE, mediaRelatedLinks } from "../../lib/media/media-related";

/**
 * Cross-*hub* destinations only.
 *
 * The strip used to carry Media Kit and Community Impact as well, both of which
 * this page already owns: Kit and Impact are tabs one row down, and the Impact
 * panel has its own "Open Community Impact" button that points at `/impact`
 * rather than the Business tab — so the header offered a second control with the
 * same name and a different destination. What is left is the two surfaces that
 * genuinely live in another hub.
 */
const MEDIA_CROSS_HUB_LINKS = MEDIA_RELATED_INCLUDE.filter(
  (id) => id === "outreach-calendar" || id === "sponsor-wall",
);

export function MediaRelatedStrip({ orgId }: { orgId?: string | null }) {
  const links = mediaRelatedLinks(orgId, { include: MEDIA_CROSS_HUB_LINKS });
  if (!links.length) return null;
  return (
    <nav className="product-hub-related media-related" aria-label="Related media tools">
      {links.map((link) => (
        <Button as="a" variant="secondary" key={link.id} href={link.href}>
          {link.label}
        </Button>
      ))}
    </nav>
  );
}
