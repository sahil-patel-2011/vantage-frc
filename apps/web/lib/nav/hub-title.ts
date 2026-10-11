import { hubPageTitle } from "./hub-navigation";
import { hubById, isHubTab, type ProductHubDef } from "./hubs";

/** What the root layout's title template appends to every page title. */
export const PRODUCT_TITLE_SUFFIX = " — Vantage";

/** The tab a hub opens on for `?tab=`: the asked-for tab when the hub has it, else its default. */
export function hubInitialTab(hubId: ProductHubDef["id"], tab: string | null | undefined): string {
  const hub = hubById(hubId);
  return isHubTab(hub, tab) ? tab : hub.defaultTab;
}

/**
 * The browser tab title for a hub tab: "Money · Business", "My Day · Competition".
 *
 * Every tab of a hub used to share the hub's static title ("Competition — Vantage" for Scout,
 * Match plan and My Day), so the tab strip, history and a screen reader's page announcement could
 * not tell them apart (WCAG 2.4.2). The page part is the hub's own h1 for that tab.
 */
export function hubDocumentTitle(hubId: ProductHubDef["id"], tab: string | null | undefined): string {
  const hub = hubById(hubId);
  const page = hubPageTitle(hub, hubInitialTab(hubId, tab));
  return page === hub.label ? hub.label : `${page} · ${hub.label}`;
}
