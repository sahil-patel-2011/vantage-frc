import type { BusinessRelatedId } from "../business/business-related";
import { COSTS_RELATED_INCLUDE } from "../business/business-related";
import { hubHref } from "../nav/hubs";
import { withOrgHref } from "../nav/product-nav";

/** Focused Soft-UI Business strip when Season Costs is open (never DEMO $). */
export const COSTS_BUSINESS_RELATED_INCLUDE: BusinessRelatedId[] = [...COSTS_RELATED_INCLUDE];

/**
 * Soft-UI related surfaces for Season Costs.
 * Real-world spend sits next to Orders / Fundraisers / Business budget — never DEMO dollars.
 */
export const COSTS_RELATED_LINKS = [
  { id: "orders", label: "Orders", kind: "hub" as const, tab: "orders" },
  { id: "fundraisers", label: "Fundraisers", kind: "path" as const, path: "/fundraisers" },
  { id: "budget", label: "Business budget", kind: "hub" as const, tab: "budget" },
  { id: "finance-ai", label: "Finance in Ask AI", kind: "path" as const, path: "/ai?tab=finance" },
] as const;

export type CostsRelatedId = (typeof COSTS_RELATED_LINKS)[number]["id"];

export type CostsRelatedLink = {
  id: CostsRelatedId;
  label: string;
  href: string;
};

/** Cross-links for Season Costs Soft-UI (never DEMO $). */
export function costsRelatedLinks(
  orgId?: string | null,
  options?: { active?: CostsRelatedId; include?: CostsRelatedId[] },
): CostsRelatedLink[] {
  const include = options?.include ? new Set(options.include) : null;
  return COSTS_RELATED_LINKS.filter((link) => {
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

/** All-in / budget dollars — blank until there is real logged spend or a set budget. */
export function formatCostUsdDisplay(amount: number | null | undefined, hasEvidence: boolean): string {
  if (!hasEvidence || amount == null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(amount);
}

/** Budget % used — blank until a season budget exists (never a DEMO 0%). */
export function formatBudgetPctDisplay(pctUsed: number | null | undefined): string {
  if (pctUsed == null) return "—";
  return `${Math.round(pctUsed * 100)}%`;
}
