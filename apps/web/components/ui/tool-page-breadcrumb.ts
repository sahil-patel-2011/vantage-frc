import { hubById, hubWorkbenchHref, type ProductHubDef } from "../../lib/nav/hubs";

export type ToolPageCrumb = {
  label: string;
  /** Absent on the current (last) crumb. */
  href?: string;
};

export type ToolPageBreadcrumbOptions = {
  orgId?: string | null;
  /** Overrides the hub tab label for the current crumb (e.g. "FMEA" where the tab says "Robot"). */
  toolLabel?: string;
};

/**
 * Breadcrumb trail for a leaf tool page: `Hub / Tool`.
 *
 * The hub crumb links to the workbench that owns the tool (hubWorkbenchHref), so
 * "Build" from /cad-vault lands on Build › CAD rather than back on the leaf the
 * user is trying to leave. An unknown tab id degrades to the hub's default
 * workbench and keeps the id as its label — never a dead link.
 */
export function toolPageBreadcrumb(
  hubId: ProductHubDef["id"],
  tabId: string,
  options?: ToolPageBreadcrumbOptions,
): ToolPageCrumb[] {
  const hub = hubById(hubId);
  const tab = hub.tabs.find((entry) => entry.id === tabId);
  return [
    { label: hub.label, href: hubWorkbenchHref(hubId, tabId, options?.orgId) },
    { label: options?.toolLabel ?? tab?.label ?? tabId },
  ];
}

/** Plain-text form of the trail, for aria labels and tests. */
export function toolPageBreadcrumbText(crumbs: ToolPageCrumb[]): string {
  return crumbs.map((crumb) => crumb.label).join(" / ");
}
