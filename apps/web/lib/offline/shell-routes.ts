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
  "/picklist-justifier",
  "/opponent-watchlist",
  "/alliance-sim",
  "/briefing",
  "/award-tracker",
  "/epa-trend-alerts",
  "/rankings",
  "/grant-report",
  "/media-kit",
  "/sponsor-wall",
  "/sponsor-suite",
  "/outreach-calendar",
  "/visit-invites",
  "/judge-sim",
  "/impact-essay",
  "/battery-rotation",
  "/vendors",
  "/season-report",
  "/media",
  "/battery-health-forecast",
  "/vendor-lead-times",
  "/bin-shelf-locator",
  "/build-burndown",
  "/cad-change-radar",
  "/code-deploy-log",
  "/control-map",
  "/cross-team-scrim",
  "/decision-search",
  "/decisions",
  "/failure-patterns",
  "/grant-eligibility-matcher",
  "/hours-self-view",
  "/knowledge-gap",
  "/matching-gift-finder",
  "/onboarding-buddy",
  "/risk-burndown",
  "/spare-robot-kit",
  "/sponsor-renewal-roi",
  "/team-health-dashboard",
  "/spare-forecast",
  "/sketch-to-brief",
  "/scout-assisted-count",
  "/scout-coverage-live",
  "/scout-field-budget",
  "/scouting-heat-signals",
  "/scout-data-impact",
  "/scout-disagreements",
  "/scout-accuracy",
  "/scout-crossval",
  "/rule-impact",
  "/season-planning-workspace",
  "/retro",
  "/team/data",
  "/tuning-autopilot",
  "/fundraisers",
  "/impact",
  "/orders",
  "/team/grants",
  "/practice",
  "/manufacturing",
  "/attendance",
  "/kickoff",
  "/match-debrief",
  "/ranking-projection",
  "/whiteboard",
  "/robot",
  "/my-kit",
  "/part-requests",
  "/recognition",
  "/subteams",
  "/budget",
  "/sponsorship",
  "/safety",
  "/writer",
  "/learning",
  "/training",
  "/tool-checkout",
  "/goals",
  "/cad-vault",
  "/cad-learn",
  "/cad-review-queue",
  "/reimbursements",
  "/costs",
  "/duties",
  "/announcements",
  "/risks",
  "/subsystem-signoff",
  "/prototype-tracker",
  "/equipment-maintenance",
  "/bringup",
  "/notebook",
  "/auto-routines",
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
  if (bare.startsWith("/scouting-heat-signals")) return "Scouting Heat Signals";
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
  if (bare.startsWith("/team/data")) return "Team Data";
  if (bare.startsWith("/team/grants")) return "Grant writing";
  if (bare === "/team") return "Team";
  if (bare.startsWith("/todos") || bare.startsWith("/tasks")) return "Todos";
  if (bare.startsWith("/logistics")) return "Logistics";
  if (bare.startsWith("/build-burndown")) return "Build Burndown";
  if (bare.startsWith("/kickoff")) return "Kickoff";
  if (bare.startsWith("/whiteboard")) return "Whiteboard";
  if (bare.startsWith("/manufacturing")) return "Manufacturing";
  if (bare.startsWith("/practice")) return "Practice";
  if (bare.startsWith("/attendance")) return "Attendance";
  if (bare.startsWith("/build")) return "Build";
  if (bare.startsWith("/files")) return "Files";
  if (bare.startsWith("/docs") || bare.startsWith("/help")) return "Docs";
  if (bare.startsWith("/dashboard")) return "Home";
  if (bare.startsWith("/strategy/draft")) return "Alliance board";
  if (bare.startsWith("/strategy")) return "Strategy";
  if (bare.startsWith("/hours-self-view")) return "My Hours";
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
  if (bare.startsWith("/picklist-justifier")) return "Pick-list Justifier";
  if (bare.startsWith("/opponent-watchlist")) return "Opponent Watchlist";
  if (bare.startsWith("/alliance-sim")) return "Alliance Sim";
  if (bare.startsWith("/briefing")) return "Pre-match briefing";
  if (bare.startsWith("/award-tracker")) return "Award Tracker";
  if (bare.startsWith("/epa-trend-alerts")) return "EPA Trend Alerts";
  if (bare.startsWith("/ranking-projection")) return "Ranking projection";
  if (bare.startsWith("/rankings")) return "Rankings";
  if (bare.startsWith("/grant-report")) return "Grant Report";
  if (bare.startsWith("/media-kit")) return "Media Kit";
  if (bare.startsWith("/media")) return "Media";
  if (bare.startsWith("/sponsorship")) return "Sponsorship";
  if (bare.startsWith("/sponsor-suite")) return "Sponsor Suite";
  if (bare.startsWith("/sponsor-wall")) return "Sponsor Wall";
  if (bare.startsWith("/outreach-calendar")) return "Outreach Calendar";
  if (bare.startsWith("/visit-invites")) return "Visit Invites";
  if (bare.startsWith("/judge-sim")) return "Judge-Pitch Simulator";
  if (bare.startsWith("/impact-essay")) return "Impact Essay";
  if (bare.startsWith("/impact")) return "Community Impact";
  if (bare.startsWith("/fundraisers")) return "Fundraisers";
  if (bare.startsWith("/orders")) return "Orders";
  if (bare.startsWith("/battery-rotation")) return "Battery Rotation";
  if (bare.startsWith("/vendors")) return "Vendors";
  if (bare.startsWith("/season-report")) return "Season Report";
  if (bare.startsWith("/battery-health-forecast")) return "Battery Health Forecast";
  if (bare.startsWith("/vendor-lead-times")) return "Vendor Lead Times";
  if (bare.startsWith("/bin-shelf-locator")) return "Bin/Shelf Locator";
  if (bare.startsWith("/cad-vault")) return "CAD Vault";
  if (bare.startsWith("/cad-learn")) return "CAD Learn";
  if (bare.startsWith("/cad-review-queue")) return "CAD Review Queue";
  if (bare.startsWith("/cad-change-radar")) return "CAD Change Radar";
  if (bare.startsWith("/code-deploy-log")) return "Code Deploy Log";
  if (bare.startsWith("/control-map")) return "Control Map";
  if (bare.startsWith("/cross-team-scrim")) return "Cross-Team Scrims";
  if (bare.startsWith("/decision-search")) return "Decision Search";
  if (bare.startsWith("/decisions")) return "Decision Log";
  if (bare.startsWith("/failure-patterns")) return "Repeat Failure Patterns";
  if (bare.startsWith("/grant-eligibility-matcher")) return "Grant Eligibility Matcher";
  if (bare.startsWith("/knowledge-gap")) return "Knowledge-gap detective";
  if (bare.startsWith("/matching-gift-finder")) return "Matching Gift Finder";
  if (bare.startsWith("/onboarding-buddy")) return "Onboarding Buddy";
  if (bare.startsWith("/risk-burndown")) return "Risk-Register Burndown";
  if (bare.startsWith("/risks")) return "Risk Register";
  if (bare.startsWith("/subsystem-signoff")) return "Subsystem Sign-off";
  if (bare.startsWith("/prototype-tracker")) return "Prototype-to-Decision Tracker";
  if (bare.startsWith("/equipment-maintenance")) return "Equipment Maintenance";
  if (bare.startsWith("/spare-robot-kit")) return "Spare Robot Kit";
  if (bare.startsWith("/spare-forecast")) return "Spare Forecast";
  if (bare.startsWith("/sponsor-renewal-roi")) return "Sponsor Renewal ROI";
  if (bare.startsWith("/team-health-dashboard")) return "Team Health";
  if (bare.startsWith("/sketch-to-brief")) return "Sketch-to-Brief";
  if (bare.startsWith("/scout-assisted-count")) return "Scout-Assisted Count";
  if (bare.startsWith("/scout-coverage-live")) return "Scout Coverage Live";
  if (bare.startsWith("/scout-field-budget")) return "Field-Count Budget";
  if (bare.startsWith("/scout-data-impact")) return "Scout Data Impact";
  if (bare.startsWith("/scout-disagreements")) return "Scout Disagreements";
  if (bare.startsWith("/scout-accuracy")) return "Scout Accuracy";
  if (bare.startsWith("/scout-crossval")) return "Scout Cross-Validation";
  if (bare.startsWith("/rule-impact")) return "Rule Impact Analyzer";
  if (bare.startsWith("/season-planning-workspace")) return "Season Planning";
  if (bare.startsWith("/retro")) return "Retro";
  if (bare.startsWith("/tuning-autopilot")) return "Tuning Autopilot";
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
  if (bare.startsWith("/robot")) return "Robot";
  if (bare.startsWith("/my-kit")) return "My Kit";
  if (bare.startsWith("/part-requests")) return "Part requests";
  if (bare.startsWith("/recognition")) return "Recognition";
  if (bare.startsWith("/budget")) return "Season budget";
  if (bare.startsWith("/subteams")) return "Subteam progress";
  if (bare.startsWith("/safety")) return "Safety";
  if (bare.startsWith("/writer")) return "Writer";
  if (bare.startsWith("/learning")) return "Learning";
  if (bare.startsWith("/training")) return "Training";
  if (bare.startsWith("/tool-checkout")) return "Tool checkout";
  if (bare.startsWith("/goals")) return "Goals";
  if (bare.startsWith("/reimbursements")) return "Reimbursements";
  if (bare.startsWith("/costs")) return "Season Costs";
  if (bare.startsWith("/duties")) return "Duties";
  if (bare.startsWith("/announcements")) return "Announcements";
  if (bare.startsWith("/match-delta-watcher")) return "Match-delta watcher";
  if (bare.startsWith("/match-video-index")) return "Match video index";
  if (bare.startsWith("/match-strategy-cards")) return "Match strategy cards";
  if (bare.startsWith("/match-debrief")) return "Match debrief";
  if (bare.startsWith("/match-copilot")) return "Match Copilot";
  if (bare.startsWith("/event-readiness")) return "Event readiness";
  if (bare.startsWith("/bringup")) return "Bring-up";
  if (bare.startsWith("/notebook")) return "Engineering notebook";
  if (bare.startsWith("/auto-routines")) return "Auto routines";
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
