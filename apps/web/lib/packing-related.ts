import { withOrgHref } from "./nav/product-nav";

/** Soft-UI next steps from a packing list — shelf, trip, then the dated pre-event flow. */
export const PACKING_RELATED_LINKS = [
  { id: "spares", label: "Consumables", path: "/spares" },
  { id: "logistics", label: "Logistics", path: "/logistics" },
  { id: "event-readiness", label: "Event readiness", path: "/event-readiness" },
] as const;

export type PackingRelatedId = (typeof PACKING_RELATED_LINKS)[number]["id"];

export type PackingRelatedLink = {
  id: PackingRelatedId;
  label: string;
  href: string;
};

export const PACKING_RELATED_INCLUDE: PackingRelatedId[] = [
  "spares",
  "logistics",
  "event-readiness",
];

export function packingRelatedLinks(
  orgId?: string | null,
  options?: { include?: PackingRelatedId[] },
): PackingRelatedLink[] {
  const include = options?.include ? new Set(options.include) : null;
  return PACKING_RELATED_LINKS.filter((link) => !include || include.has(link.id)).map((link) => ({
    id: link.id,
    label: link.label,
    href: withOrgHref(link.path, orgId),
  }));
}
