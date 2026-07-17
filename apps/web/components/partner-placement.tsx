"use client";

import { useEffect, useState } from "react";
import { sponsorAssetUrl, type PartnerSurface, type PublicPartnerPlacement } from "../lib/partner-placements";

export default function PartnerPlacement({ orgId, surface, title = "Team partners" }: { orgId: string; surface: PartnerSurface; title?: string }) {
  const [placements, setPlacements] = useState<PublicPartnerPlacement[]>([]);
  useEffect(() => {
    let active = true;
    void fetch(`/api/partner-placements?orgId=${encodeURIComponent(orgId)}&surface=${surface}`)
      .then(async (response) => response.ok ? response.json() as Promise<{ placements?: PublicPartnerPlacement[] }> : { placements: [] })
      .then((result) => { if (active) setPlacements(result.placements ?? []); })
      .catch(() => { if (active) setPlacements([]); });
    return () => { active = false; };
  }, [orgId, surface]);
  if (!placements.length) return null;
  return <aside className={`partner-placement-strip${surface === "pit_footer" ? " compact" : ""}`} aria-label={title}>
    <header><span>{title}</span><small>Team-approved partner recognition</small></header>
    <div>{placements.map((placement) => {
      const body = <><em className="partner-placement-logo">{placement.assetPublicId ? <img src={sponsorAssetUrl(placement.assetPublicId)} alt={`${placement.sponsorName} logo`} /> : <b>{placement.sponsorName.slice(0, 2).toUpperCase()}</b>}</em><span><strong>{placement.sponsorName}</strong>{placement.headline ? <small>{placement.headline}</small> : null}</span><em aria-hidden="true">↗</em></>;
      return placement.linkUrl
        ? <a key={placement.id} href={placement.linkUrl} target="_blank" rel="sponsored noopener noreferrer">{body}</a>
        : <article key={placement.id}>{body}</article>;
    })}</div>
  </aside>;
}
