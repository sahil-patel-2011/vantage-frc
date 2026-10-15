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
    const menuTab = hubNavigationSections(hub, hub.tabs).some(entry => entry.id === selected);
    if (!menuTab && selected !== "pit-tv" && selected !== "my-day" && allowed(`${hub.href}?tab=${workbench}`)) query.set("tab", workbench);
  }
  return query.toString();
}

const DESTINATION_ICONS: Record<string, ProductNavIcon> = {
  scouting: "scout",
  forms: "form", "scout-coverage-live": "assignment",
  teams: "stats", strategy: "target", picks: "rank", command: "calendar",
  "match-checklist": "clipboard", "pit-tv": "display", calendar: "calendar",
  messages: "chat", attendance: "users", todos: "clipboard", knowledge: "grid",
  kickoff: "bolt", cad: "cube", code: "code", robot: "cube", finance: "stats",
  sponsors: "users", grants: "clipboard", evidence: "grid", overview: "home",
  chat: "sparkles", writer: "clipboard", budgets: "stats", connections: "globe",
};

/**
 * Tabs a hub does not draw inline open their own page. The menu links straight there, so a tap
 * is one page load, not a hub that loads and then replaces itself. Permission is still checked
 * on the hub tab.
 */
const DIRECT_ROUTES: Record<string, string> = {
  "scout-coverage-live": "/scout-coverage-live",
  "pit-tv": "/display",
};

/**
 * The four workspaces, the same in the sidebar and the phone menu. Ask AI is not a workspace: it
 * has one door per screen size (the sidebar footer on a computer, the top bar on a phone), and
 * its limits live in Settings. The list is complete whatever is pinned: pins are shortcuts, and
 * a place never leaves its workspace.
 */
export function mainMenuSections(groups: readonly ProductNavGroup[], allowed: (href: string) => boolean, includeScout = true) {
  const definitions: { id: ProductHubDef["id"]; label: string; icon: ProductNavIcon }[] = [
    { id: "competition", label: "Competition", icon: "swords" },
    { id: "team", label: "Team", icon: "users" },
    { id: "build", label: "Build", icon: "cube" },
    { id: "business", label: "Business", icon: "clipboard" },
  ];
  const available = new Set(groups.flatMap(group => group.items.map(item => item.href.split("?")[0])));
  return definitions.flatMap(definition => {
    const hub = hubById(definition.id);
    if (!available.has(hub.href)) return [];
    const items: { href: string; gate: string; label: string; icon: ProductNavIcon }[] = hubNavigationSections(hub, hub.tabs)
      .filter(section => includeScout || !(hub.id === "competition" && section.id === "scouting"))
      .map(section => {
        const gate = `${hub.href}?tab=${section.id}`;
        return { href: DIRECT_ROUTES[section.id] ?? gate, gate, label: section.label, icon: DESTINATION_ICONS[section.id] ?? definition.icon };
      });
    if (hub.id === "competition") {
      items.push({ href: "/competition?tab=my-day", gate: "/competition?tab=my-day", label: "My Day", icon: "calendar" });
      items.push({ href: DIRECT_ROUTES["pit-tv"]!, gate: "/competition?tab=pit-tv", label: "Pit TV", icon: "display" });
    }
    if (hub.id === "team") {
      // The team's own lessons and PDFs (/learn/team): the team's library, so it lives with
      // the team, not three levels down under Build › CAD.
      items.push({ href: "/learn/team", gate: "/learn/team", label: "Team resources", icon: "book" });
    }
    const permitted = items.filter(item => allowed(item.gate)).map(({ href, label, icon }) => ({ href, label, icon }));
    return permitted.length ? [{ ...definition, items: permitted }] : [];
  });
}
