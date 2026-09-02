/**
 * Business hub tabs rendered inline by <BusinessClient>. Every other tab in
 * hubById("business") lives on its own route, so the hub links straight there.
 * Ids must stay in sync with lib/nav/hubs.ts — see business-tabs.test.ts.
 */
export const BUSINESS_EMBEDDED_TABS = [
  "overview",
  "finance",
  "budget",
  "orders",
  "sponsors",
  "sponsorship",
  "placements",
  "grants",
  "evidence",
] as const;

export type BusinessTab = (typeof BUSINESS_EMBEDDED_TABS)[number];

export function isBusinessTab(value: string | null | undefined): value is BusinessTab {
  return Boolean(value && (BUSINESS_EMBEDDED_TABS as readonly string[]).includes(value));
}
