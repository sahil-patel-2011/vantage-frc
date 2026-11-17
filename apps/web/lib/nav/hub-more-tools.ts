import { hubPageTitle } from "./hub-navigation";
import { hubHref, hubPrimaryTabs, type ProductHubDef } from "./hubs";

export type HubMoreTool = { id: string; label: string; href: string };
export type HubMoreToolsGroup = { id: string; label: string; tools: HubMoreTool[] };

/**
 * A place's "More tools": every tool that is not already a section link, grouped under the
 * section it belongs to. A section that is not on the row leads its own group, named by its
 * page title (Build's failure log is "Failure notes", not a second "Robot"). Tools kept out of
 * the strip or out of search (meta views and second doors to one page) stay out here too, so
 * nothing is listed twice. `allowed` receives the tool's hub URL and applies the same access
 * and sponsor rules as the section row.
 */
export function hubMoreTools(
  hub: ProductHubDef,
  onRow: ReadonlySet<string>,
  allowed: (href: string) => boolean,
): HubMoreToolsGroup[] {
  return hubPrimaryTabs(hub).flatMap((section) => {
    if (!allowed(hubHref(hub.href, section.id))) return [];
    const root = onRow.has(section.id)
      ? []
      : [{ id: section.id, label: hubPageTitle(hub, section.id), href: hubHref(hub.href, section.id) }];
    const tools = hub.tabs
      .filter((tab) => tab.group === section.id && tab.inStrip !== false && tab.inSearch !== false && !onRow.has(tab.id))
      .map((tab) => ({ id: tab.id, label: tab.label, href: hubHref(hub.href, tab.id) }))
      .filter((tool) => allowed(tool.href));
    const listed = [...root, ...tools];
    return listed.length ? [{ id: section.id, label: section.label, tools: listed }] : [];
  });
}
