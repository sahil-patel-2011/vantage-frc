import { hubById, hubWorkbenchId, PRODUCT_HUBS, type ProductHubDef } from "./hubs";
import { hubNavigationSections } from "./hub-navigation";
import type { ProductNavGroup, ProductNavIcon } from "./product-nav";

/** Root URLs represent the hub's actual default task, including the current-page cue. */
export function mainMenuSearch(pathname: string, search: string, allowed: (href: string) => boolean = () => true): string {
  const hub = PRODUCT_HUBS.find(entry => entry.href === pathname);
  const query = new URLSearchParams(search);
  if (hub && !query.has("tab")) {
    const tab = allowed(`${hub.href}?tab=${hub.defaultTab}`) ? hub.defaultTab
      : hubNavigationSections(hub, hub.tabs).find(entry => allowed(`${hub.href}?tab=${entry.id}`))?.id;
    if (tab) query.set("tab", tab);
  }
  // Direct menu destinations keep their own cue; other inner tools highlight
  // their visible workbench so location remains clear.
  if (hub && query.has("tab")) {
    const selected = query.get("tab")!;
    const workbench = hubWorkbenchId(hub, selected);
    const menuTab = hubNavigationSections(hub, hub.tabs).some(entry => entry.id === selected)
      || (hub.id === "competition" && ["forms", "scout-coverage-live"].includes(selected));
    if (!menuTab && selected !== "pit-tv" && allowed(`${hub.href}?tab=${workbench}`)) query.set("tab", workbench);
  }
  return query.toString();
}

const DESTINATION_ICONS: Record<string, ProductNavIcon> = {
  teams: "stats", strategy: "target", picks: "rank", command: "calendar",
  "match-checklist": "clipboard", "pit-tv": "display", calendar: "calendar",
  messages: "chat", attendance: "users", todos: "clipboard", knowledge: "grid",
  kickoff: "bolt", cad: "cube", code: "code", robot: "cube", finance: "stats",
  sponsors: "users", grants: "clipboard", evidence: "grid", overview: "home",
  chat: "sparkles", writer: "clipboard", budgets: "stats", connections: "globe",
};

/** Shared menu destinations keep the same team and tab permission checks as pages. */
export function mainMenuSections(groups: readonly ProductNavGroup[], allowed: (href: string) => boolean) {
  const definitions: { id: ProductHubDef["id"]; label: string; icon: ProductNavIcon }[] = [
    { id: "competition", label: "Competition tools", icon: "swords" },
    { id: "team", label: "Team", icon: "users" },
    { id: "build", label: "Build", icon: "cube" },
    { id: "business", label: "Business", icon: "clipboard" },
    { id: "ai", label: "AI", icon: "sparkles" },
  ];
  const available = new Set(groups.flatMap(group => group.items.map(item => item.href.split("?")[0])));
  return definitions.flatMap(definition => {
    const hub = hubById(definition.id);
    if (hub.id !== "ai" && !available.has(hub.href)) return [];
    const items = hubNavigationSections(hub, hub.tabs)
      .filter(section => !(hub.id === "competition" && section.id === "scouting"))
      .map(section => ({ href: `${hub.href}?tab=${section.id}`, label: section.label, icon: DESTINATION_ICONS[section.id] ?? definition.icon }));
    if (hub.id === "competition") {
      items.unshift({ href: "/competition?tab=forms", label: "Scouting forms", icon: "form" },
        { href: "/competition?tab=scout-coverage-live", label: "Scout assignments", icon: "assignment" });
      items.push({ href: "/competition?tab=pit-tv", label: "Pit display", icon: "display" });
    }
    const permitted = items.filter(item => allowed(item.href));
    return permitted.length ? [{ ...definition, items: permitted }] : [];
  });
}
