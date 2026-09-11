import { hubHref } from "../nav/hubs";
import { withOrgHref } from "../nav/product-nav";

/** Soft-UI related Business surfaces for sponsor CRM / placements / grant writing. */
export const BUSINESS_RELATED_LINKS = [
  { id: "finance", label: "Money", kind: "hub" as const, tab: "finance" },
  { id: "sponsors", label: "Sponsors", kind: "hub" as const, tab: "sponsors" },
  { id: "placements", label: "Partners", kind: "hub" as const, tab: "placements" },
  { id: "sponsorship", label: "Packages", kind: "hub" as const, tab: "sponsorship" },
  { id: "orders", label: "Orders", kind: "hub" as const, tab: "orders" },
  { id: "grants", label: "Grants", kind: "hub" as const, tab: "grants" },
  { id: "evidence", label: "Outreach", kind: "hub" as const, tab: "evidence" },
  { id: "fundraisers", label: "Fundraisers", kind: "path" as const, path: "/fundraisers" },
  { id: "costs", label: "Season Costs", kind: "path" as const, path: "/costs" },
  { id: "impact", label: "Community Impact", kind: "path" as const, path: "/impact" },
  { id: "awards", label: "Awards", kind: "path" as const, path: "/team/awards" },
  { id: "writer", label: "Writer", kind: "path" as const, path: "/writer" },
  { id: "grant-workbench", label: "Grant writing", kind: "path" as const, path: "/team/grants" },
  { id: "finance-ai", label: "Ask AI about money", kind: "path" as const, path: "/ai?tab=finance" },
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

/** This week's student/mentor funding strip — Sponsors · Budget · Grants. */
export const BUSINESS_FUNDING_RELATED_INCLUDE: BusinessRelatedId[] = [
  "sponsors",
  "budget",
  "grants",
];

/** Fundraisers Soft-UI strip (`/fundraisers`) — sponsors, grants, orders, season costs. */
export const FUNDRAISERS_RELATED_INCLUDE: BusinessRelatedId[] = [
  "finance",
  "sponsors",
  "grants",
  "orders",
  "costs",
  "budget",
  "finance-ai",
];

/** Orders Soft-UI strip (`/orders` + Business Orders) — sponsors, fundraisers, budget, season costs. */
export const ORDERS_RELATED_INCLUDE: BusinessRelatedId[] = [
  "finance",
  "sponsors",
  "fundraisers",
  "costs",
  "budget",
  "grants",
  "finance-ai",
];

/** Season Costs Soft-UI strip (`/costs`) — orders, fundraisers, Business budget. */
export const COSTS_RELATED_INCLUDE: BusinessRelatedId[] = [
  "finance",
  "orders",
  "fundraisers",
  "budget",
  "finance-ai",
];

/** Season finance desk Soft-UI strip (`/business?tab=finance`). */
export const SEASON_FINANCE_RELATED_INCLUDE: BusinessRelatedId[] = [
  "budget",
  "orders",
  "sponsors",
  "grants",
  "fundraisers",
  "costs",
  "finance-ai",
];

/** Community Impact Soft-UI strip (`/impact`) — Awards · Outreach · Writer. */
export const IMPACT_RELATED_INCLUDE: BusinessRelatedId[] = ["awards", "evidence", "writer"];

/** Awards workbench Soft-UI strip (`/team/awards`) — Community Impact · Outreach · Writer. */
export const AWARDS_RELATED_INCLUDE: BusinessRelatedId[] = ["impact", "evidence", "writer"];

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
