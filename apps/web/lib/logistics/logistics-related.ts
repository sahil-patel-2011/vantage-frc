import { hubHref } from "../nav/hubs";
import { withOrgHref } from "../nav/product-nav";

/** Soft-UI related Event Day / Team surfaces for logistics travel. */
export const LOGISTICS_RELATED_LINKS = [
  { id: "command", label: "Event Day", kind: "competition" as const, tab: "command" },
  { id: "my-day", label: "My Day", kind: "competition" as const, tab: "my-day" },
  { id: "calendar", label: "Team calendar", kind: "path" as const, path: "/team/calendar?tab=trip" },
  { id: "visit-invites", label: "Visit invites", kind: "path" as const, path: "/visit-invites" },
] as const;

export type LogisticsRelatedId = (typeof LOGISTICS_RELATED_LINKS)[number]["id"];

export type LogisticsRelatedLink = {
  id: LogisticsRelatedId;
  label: string;
  href: string;
};

/** Cross-links for Logistics Soft-UI (never DEMO placeholders). */
export function logisticsRelatedLinks(
  orgId?: string | null,
  options?: { active?: LogisticsRelatedId; include?: LogisticsRelatedId[] },
): LogisticsRelatedLink[] {
  const include = options?.include ? new Set(options.include) : null;
  return LOGISTICS_RELATED_LINKS.filter((link) => {
    if (link.id === options?.active) return false;
    if (include && !include.has(link.id)) return false;
    return true;
  }).map((link) => {
    if (link.kind === "competition") {
      return { id: link.id, label: link.label, href: hubHref("/competition", link.tab, orgId) };
    }
    return { id: link.id, label: link.label, href: withOrgHref(link.path, orgId) };
  });
}
