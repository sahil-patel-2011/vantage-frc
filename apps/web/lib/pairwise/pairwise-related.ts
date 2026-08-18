import { hubHref } from "../nav/hubs";
import { withOrgHref } from "../nav/product-nav";

export const PAIRWISE_RELATED_LINKS = [
  { id: "scouting", label: "Scouting", tab: "scouting" },
  { id: "pick-clock", label: "Pick clock", tab: "pick-clock" },
  { id: "chemistry", label: "Chemistry", tab: "chemistry" },
  { id: "strategy", label: "Strategy", tab: "strategy" },
] as const;

export function pairwiseRelatedLinks(orgId?: string | null) {
  return [
    ...PAIRWISE_RELATED_LINKS.map((link) => ({
      id: link.id,
      label: link.label,
      href: hubHref("/competition", link.tab, orgId),
    })),
    { id: "team-tags", label: "Drive-team tags", href: withOrgHref("/team-tags", orgId) },
  ];
}
