import { hubHref } from "../nav/hubs";
import { withOrgHref } from "../nav/product-nav";

/** Soft-UI related Business surfaces for sponsor CRM / placements / grant writing. */
export const BUSINESS_RELATED_LINKS = [
  { id: "sponsors", label: "Sponsor CRM", kind: "hub" as const, tab: "sponsors" },
  { id: "placements", label: "Partner packages", kind: "hub" as const, tab: "placements" },
  { id: "sponsorship", label: "Sponsorship one-pager", kind: "hub" as const, tab: "sponsorship" },
  { id: "orders", label: "Orders", kind: "hub" as const, tab: "orders" },
  { id: "grants", label: "Grants", kind: "hub" as const, tab: "grants" },
  { id: "fundraisers", label: "Fundraisers", kind: "path" as const, path: "/fundraisers" },
  { id: "writer", label: "Grant & sponsor writer", kind: "path" as const, path: "/writer" },
  { id: "grant-workbench", label: "Grant writing workbench", kind: "path" as const, path: "/team/grants" },
  { id: "finance-ai", label: "Finance-in-AI", kind: "path" as const, path: "/ai?tab=finance" },
  { id: "budget", label: "Budget", kind: "hub" as const, tab: "budget" },
] as const;

export type BusinessRelatedId = (typeof BUSINESS_RELATED_LINKS)[number]["id"];

export type BusinessRelatedLink = {
  id: BusinessRelatedId;
  label: string;
  href: string;
};

/** Sponsor CRM Soft-UI strip. */
export const SPONSOR_CRM_RELATED_INCLUDE: BusinessRelatedId[] = [
  "placements",
  "fundraisers",
  "grants",
  "orders",
  "finance-ai",
];

/** Partner placements Soft-UI strip. */
export const PLACEMENTS_RELATED_INCLUDE: BusinessRelatedId[] = [
  "sponsors",
  "sponsorship",
  "fundraisers",
  "orders",
  "finance-ai",
];

/** Grant writing Soft-UI strip (`/team/grants`) — sponsors, fundraising, writer. */
export const GRANTS_WRITING_RELATED_INCLUDE: BusinessRelatedId[] = [
  "sponsors",
  "fundraisers",
  "writer",
  "grants",
  "finance-ai",
];

/** Business hub Grants tab Soft-UI strip. */
export const BUSINESS_GRANTS_RELATED_INCLUDE: BusinessRelatedId[] = [
  "grant-workbench",
  "sponsors",
  "fundraisers",
  "writer",
  "finance-ai",
];

/** Cross-links for Business Soft-UI (never DEMO placeholders). */
export function businessRelatedLinks(
  orgId?: string | null,
  options?: { active?: BusinessRelatedId; include?: BusinessRelatedId[] },
): BusinessRelatedLink[] {
  const include = options?.include ? new Set(options.include) : null;
  return BUSINESS_RELATED_LINKS.filter((link) => {
    if (link.id === options?.active) return false;
    if (include && !include.has(link.id)) return false;
    return true;
  }).map((link) => {
    if (link.kind === "hub") {
      return { id: link.id, label: link.label, href: hubHref("/business", link.tab, orgId) };
    }
    return { id: link.id, label: link.label, href: withOrgHref(link.path, orgId) };
  });
}
