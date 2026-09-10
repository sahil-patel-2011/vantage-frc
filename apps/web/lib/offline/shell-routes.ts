/**
 * Routes the service worker may network-first cache for cold offline loads.
 * Keep this list tight: only pages with IndexedDB (or equivalent) feature caches.
 */

export const OFFLINE_SHELL_ROUTES = [
  "/offline",
  "/offline-shell",
  "/scouting",
  "/schedule",
  "/competition",
  "/command",
  "/calendar",
  "/team/calendar",
  "/team",
  "/todos",
  "/tasks",
  "/logistics",
  "/build",
  "/files",
  "/docs",
  "/dashboard",
  "/strategy",
  "/hours",
  "/messages",
  "/match-checklist",
  "/match-notes-timeline",
  "/pit",
  "/video-analysis",
  "/assembly-manual",
  "/packing",
  "/batteries",
  "/my-day",
  "/chemistry",
  "/pick-clock",
  "/alliance-selection-desk",
  "/print-farm",
  "/inventory",
  "/defense-planner",
  "/picklist-collab",
  "/dossier",
  "/pit-repair-triage",
  "/event-day-plan",
  "/field-reset-timer",
  "/drive-team-signals",
  "/robot-weigh-in",
  "/match-delta-watcher",
  "/match-video-index",
  "/strategy/draft",
  "/scouting/lineup",
  "/match-strategy-cards",
  "/match-copilot",
  "/event-readiness",
  "/video",
  "/inspection-copilot",
  "/inspection",
  "/fmea",
  "/match-sim",
  "/pit-map-planner",
  "/pairwise",
  "/team-tags",
  "/shift-balancer",
  "/counter-book",
  "/overnight-intel",
  "/alliance-partner-brief",
] as const;

export type OfflineShellRoute = (typeof OFFLINE_SHELL_ROUTES)[number];

/** Static assets always precached with the shell. */
export const OFFLINE_SHELL_ASSETS = ["/manifest.webmanifest", "/icon.svg", "/offline"] as const;

export function pathnameIsOfflineShell(pathname: string): boolean {
  const bare = pathname.split("?")[0]?.split("#")[0] ?? pathname;
  if (!bare.startsWith("/")) return false;
  return OFFLINE_SHELL_ROUTES.some(
    (route) => bare === route || bare.startsWith(`${route}/`),
  );
}

export function offlineCapableLabel(pathname: string): string | null {
  const bare = pathname.split("?")[0] ?? pathname;
  if (bare.startsWith("/scouting/lineup")) return "Lineup & coverage";
  if (bare.startsWith("/scouting")) return "Scouting";
  if (bare.startsWith("/schedule")) return "Schedule";
  if (bare.startsWith("/offline-shell")) return "This phone";
  if (bare === "/competition") return "Competition";
  if (bare.startsWith("/command")) return "Event Day";
  if (
    bare.startsWith("/team/calendar") ||
    bare === "/calendar" ||
    bare.startsWith("/calendar/")
  ) {
    return "Calendar";
  }
  if (bare === "/team") return "Team";
  if (bare.startsWith("/todos") || bare.startsWith("/tasks")) return "Todos";
  if (bare.startsWith("/logistics")) return "Logistics";
  if (bare.startsWith("/build")) return "Build";
  if (bare.startsWith("/files")) return "Files";
  if (bare.startsWith("/docs") || bare.startsWith("/help")) return "Docs";
  if (bare.startsWith("/dashboard")) return "Home";
  if (bare.startsWith("/strategy/draft")) return "Alliance board";
  if (bare.startsWith("/strategy")) return "Strategy";
  if (bare.startsWith("/hours")) return "Hours";
  if (bare.startsWith("/messages")) return "Chat";
  if (bare.startsWith("/match-checklist")) return "Match checklist";
  if (bare.startsWith("/match-notes-timeline")) return "Match notes";
  if (bare.startsWith("/pit-repair-triage")) return "Pit repair triage";
  if (bare === "/pit" || bare.startsWith("/pit/")) return "Pit";
  if (bare.startsWith("/video-analysis")) return "Video";
  if (bare.startsWith("/video")) return "Match video";
  if (bare.startsWith("/inspection-copilot")) return "Inspection Copilot";
  if (bare.startsWith("/inspection")) return "Inspection";
  if (bare.startsWith("/fmea")) return "FMEA";
  if (bare.startsWith("/match-sim")) return "Match Simulator";
  if (bare.startsWith("/pit-map-planner")) return "Pit Map Planner";
  if (bare.startsWith("/pairwise")) return "Pairwise ranking";
  if (bare.startsWith("/team-tags")) return "Drive-team tags";
  if (bare.startsWith("/shift-balancer")) return "Scout shift balancer";
  if (bare.startsWith("/counter-book")) return "Counter-book";
  if (bare.startsWith("/overnight-intel")) return "Overnight Intel";
  if (bare.startsWith("/alliance-partner-brief")) return "Alliance-Partner Brief";
  if (bare.startsWith("/assembly-manual")) return "Assembly manual";
  if (bare.startsWith("/packing")) return "Packing";
  if (bare.startsWith("/batteries")) return "Batteries";
  if (bare.startsWith("/my-day")) return "My Day";
  if (bare.startsWith("/chemistry")) return "Chemistry";
  if (bare.startsWith("/pick-clock")) return "Pick clock";
  if (bare.startsWith("/alliance-selection-desk")) return "Alliance selection desk";
  if (bare.startsWith("/print-farm")) return "Print Farm";
  if (bare.startsWith("/inventory")) return "Inventory";
  if (bare.startsWith("/defense-planner")) return "Defense planner";
  if (bare.startsWith("/picklist-collab")) return "Collaborative pick list";
  if (bare.startsWith("/dossier")) return "Dossier";
  if (bare.startsWith("/event-day-plan")) return "Event-day plan";
  if (bare.startsWith("/field-reset-timer")) return "Field reset timer";
  if (bare.startsWith("/drive-team-signals")) return "Drive-team signals";
  if (bare.startsWith("/robot-weigh-in")) return "Robot weigh-in";
  if (bare.startsWith("/match-delta-watcher")) return "Match-delta watcher";
  if (bare.startsWith("/match-video-index")) return "Match video index";
  if (bare.startsWith("/match-strategy-cards")) return "Match strategy cards";
  if (bare.startsWith("/match-copilot")) return "Match Copilot";
  if (bare.startsWith("/event-readiness")) return "Event readiness";
  return null;
}

/** Next App Router RSC/Flight requests must never be intercepted or cached. */
export function isRscRequest(headers: { get(name: string): string | null }): boolean {
  const accept = headers.get("accept") ?? "";
  if (accept.includes("text/x-component")) return true;
  if (headers.get("rsc") === "1" || headers.get("RSC") === "1") return true;
  if (headers.get("next-router-state-tree") || headers.get("Next-Router-State-Tree")) return true;
  if (headers.get("next-router-prefetch") || headers.get("Next-Router-Prefetch")) return true;
  return false;
}

/** Failed navigations (including PWA start) always land on the precached shell. */
export function navigationFallbackPath(): string {
  return "/offline";
}
