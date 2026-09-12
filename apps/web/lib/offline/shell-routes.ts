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
  "/intel",
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
  "/business",
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
  "/notifications",
  "/forms",
  "/incidents",
  "/roles",
  "/parts-catalog",
  "/parts-relay",
  "/cad/setup",
  "/cad/pair",
  "/account",
  "/alumni-network",
  "/auto-routines",
  "/auton-path-library",
  "/bom-cost-rollup",
  "/bringup",
  "/budget-reconciler",
  "/bus-factor",
  "/cad/connections",
  "/checklist-library",
  "/code-perf",
  "/connectors",
  "/cross-domain-alerts",
  "/data-quality-scorecard",
  "/decision-critic",
  "/degraded-mode",
  "/district-advancement",
  "/doc-roles",
  "/driver-tryouts",
  "/exit-interview",
  "/gearbox",
  "/goals-tracker",
  "/hours/kiosk",
  "/incident-heatmap",
  "/team/knowledge",
  "/knowledge-drafts",
  "/leadership",
  "/media-library",
  "/meeting-autopilot",
  "/mentor-hours",
  "/migrate",
  "/mock-judging",
  "/notebook",
  "/notifications/preferences",
  "/object-chat-bridge",
  "/parents",
  "/power-budget",
  "/presence",
  "/readiness-score",
  "/reuse-advisor",
  "/reviews",
  "/roadmap",
  "/safety-training",
  "/scout-p2p-relay",
  "/scout-schema-negotiate",
  "/scout-training-mode",
  "/scouting-schema-ab",
  "/scouting/forms",
  "/search",
  "/season-rollover",
  "/security",
  "/shooter-table",
  "/showcase",
  "/skills-graph",
  "/software-versions",
  "/spares",
  "/sponsor-tier-calculator",
  "/standup-digest",
  "/start",
  "/subsystems",
  "/support",
  "/team/admin",
  "/team/ai-bridge",
  "/team/ai-keys",
  "/team/ai-runs",
  "/team/ai-usage",
  "/team/alumni",
  "/team/awards",
  "/team/background",
  "/team/discord",
  "/team/getting-started",
  "/team/grants/calendar",
  "/team/profile",
  "/team/prompts",
  "/team/security",
  "/team/slack",
  "/team/storage",
  "/troubleshoot",
  "/tuning",
  "/weight-budget",
  "/whats-new",
  "/wiring",
  "/wiring-diagnoser",
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
  if (bare.startsWith("/scouting/forms")) return "Scout forms";
  if (bare.startsWith("/scouting-heat-signals")) return "Heat signals";
  if (bare.startsWith("/scouting-schema-ab")) return "Schema A/B";
  if (bare.startsWith("/scout-schema-negotiate")) return "Schema sync";
  if (bare.startsWith("/scout-p2p-relay")) return "Pit link";
  if (bare.startsWith("/scout-training-mode")) return "Scout training mode";
  if (bare.startsWith("/scouting")) return "Scouting";
  if (bare.startsWith("/schedule")) return "Schedule";
  if (bare.startsWith("/offline-shell")) return "This phone";
  if (bare === "/competition") return "Competition";
  if (bare.startsWith("/command")) return "Event day";
  if (
    bare.startsWith("/team/calendar") ||
    bare === "/calendar" ||
    bare.startsWith("/calendar/")
  ) {
    return "Calendar";
  }
  if (bare.startsWith("/team/data")) return "Team Data";
  if (bare.startsWith("/team/grants/calendar")) return "Grant calendar";
  if (bare.startsWith("/team/grants")) return "Grant writing";
  if (bare.startsWith("/team/alumni")) return "Alumni";
  if (bare.startsWith("/team/admin")) return "Team admin";
  if (bare.startsWith("/team/ai-bridge")) return "AI subscription bridge";
  if (bare.startsWith("/team/ai-keys")) return "AI keys";
  if (bare.startsWith("/team/ai-runs")) return "Ask AI history";
  if (bare.startsWith("/team/ai-usage")) return "Your keys usage";
  if (bare.startsWith("/team/awards")) return "Awards";
  if (bare.startsWith("/team/background")) return "Team background";
  if (bare.startsWith("/team/discord")) return "Discord";
  if (bare.startsWith("/team/getting-started")) return "Team setup";
  if (bare.startsWith("/team/profile")) return "Team profile";
  if (bare.startsWith("/team/prompts")) return "Prompts";
  if (bare.startsWith("/team/security")) return "Team security";
  if (bare.startsWith("/team/slack")) return "Slack";
  if (bare.startsWith("/team/storage")) return "Storage";
  if (bare.startsWith("/team/knowledge")) return "Playbook";
  if (bare === "/team") return "Team";
  if (bare.startsWith("/todos") || bare.startsWith("/tasks")) return "Todos";
  if (bare.startsWith("/logistics")) return "Logistics";
  if (bare.startsWith("/build-burndown")) return "Burndown";
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
  if (bare.startsWith("/hours-self-view")) return "My hours";
  if (bare.startsWith("/hours/kiosk")) return "Hours kiosk";
  if (bare.startsWith("/hours")) return "Hours";
  if (bare.startsWith("/messages")) return "Chat";
  if (bare.startsWith("/match-checklist")) return "Match checklist";
  if (bare.startsWith("/match-notes-timeline")) return "Match notes";
  if (bare.startsWith("/pit-repair-triage")) return "Repair triage";
  if (bare === "/pit" || bare.startsWith("/pit/")) return "Pit";
  if (bare.startsWith("/video-analysis")) return "Video";
  if (bare.startsWith("/video")) return "Match video";
  if (bare.startsWith("/inspection-copilot")) return "Inspection";
  if (bare.startsWith("/inspection")) return "Inspection";
  if (bare.startsWith("/fmea")) return "Failure log";
  if (bare.startsWith("/match-sim")) return "Match sim";
  if (bare.startsWith("/pit-map-planner")) return "Pit map";
  if (bare.startsWith("/pairwise")) return "Pairwise";
  if (bare.startsWith("/team-tags")) return "Drive-team tags";
  if (bare.startsWith("/shift-balancer")) return "Shifts";
  if (bare.startsWith("/counter-book")) return "Counter-book";
  if (bare === "/intel" || bare.startsWith("/intel/")) return "Research";
  if (bare.startsWith("/overnight-intel")) return "Overnight brief";
  if (bare.startsWith("/alliance-partner-brief")) return "Partner brief";
  if (bare.startsWith("/picklist-justifier")) return "Justifier";
  if (bare.startsWith("/opponent-watchlist")) return "Watchlist";
  if (bare.startsWith("/alliance-sim")) return "Alliance sim";
  if (bare.startsWith("/briefing")) return "Pre-match briefing";
  if (bare.startsWith("/award-tracker")) return "Award tracker";
  if (bare.startsWith("/epa-trend-alerts")) return "Rating alerts";
  if (bare.startsWith("/ranking-projection")) return "Rank projection";
  if (bare.startsWith("/rankings")) return "Rankings";
  if (bare.startsWith("/grant-report")) return "Reports";
  if (bare.startsWith("/media-kit")) return "Media kit";
  if (bare.startsWith("/media-library")) return "Photos & video";
  if (bare.startsWith("/media")) return "Media";
  if (bare.startsWith("/sponsorship")) return "Sponsorship";
  if (bare.startsWith("/sponsor-suite")) return "Sponsor suite";
  if (bare.startsWith("/sponsor-wall")) return "Sponsor wall";
  if (bare.startsWith("/outreach-calendar")) return "Outreach calendar";
  if (bare.startsWith("/visit-invites")) return "Visit Invites";
  if (bare.startsWith("/judge-sim")) return "Judge pitch";
  if (bare.startsWith("/impact-essay")) return "Impact essay";
  if (bare.startsWith("/impact")) return "Community Impact";
  if (bare.startsWith("/fundraisers")) return "Fundraisers";
  if (bare.startsWith("/orders")) return "Orders";
  if (bare.startsWith("/business")) return "Business";
  if (bare.startsWith("/battery-rotation")) return "Charge plan";
  if (bare.startsWith("/vendors")) return "Vendors";
  if (bare.startsWith("/season-report")) return "Season report";
  if (bare.startsWith("/battery-health-forecast")) return "Pack health";
  if (bare.startsWith("/vendor-lead-times")) return "Lead times";
  if (bare.startsWith("/bin-shelf-locator")) return "Bin locator";
  if (bare.startsWith("/cad-vault")) return "CAD vault";
  if (bare.startsWith("/cad-learn")) return "Learn CAD";
  if (bare.startsWith("/cad-review-queue")) return "CAD review queue";
  if (bare.startsWith("/cad-change-radar")) return "Change radar";
  if (bare.startsWith("/code-deploy-log")) return "Deploy log";
  if (bare.startsWith("/control-map")) return "Control map";
  if (bare.startsWith("/cross-team-scrim")) return "Scrims";
  if (bare.startsWith("/decision-search")) return "Search";
  if (bare.startsWith("/decisions")) return "Decision notes";
  if (bare.startsWith("/failure-patterns")) return "Failure patterns";
  if (bare.startsWith("/grant-eligibility-matcher")) return "Eligibility";
  if (bare.startsWith("/knowledge-gap")) return "Knowledge gaps";
  if (bare.startsWith("/matching-gift-finder")) return "Matching gifts";
  if (bare.startsWith("/onboarding-buddy")) return "Onboarding buddy";
  if (bare.startsWith("/risk-burndown")) return "Risk burndown";
  if (bare.startsWith("/risks")) return "Risk register";
  if (bare.startsWith("/subsystem-signoff")) return "Subsystem Sign-off";
  if (bare.startsWith("/prototype-tracker")) return "Prototypes";
  if (bare.startsWith("/equipment-maintenance")) return "Equipment";
  if (bare.startsWith("/cad/setup")) return "CAD setup";
  if (bare.startsWith("/cad/pair")) return "Pair this computer";
  if (bare.startsWith("/cad/connections")) return "CAD connections";
  if (bare.startsWith("/spare-robot-kit")) return "Spare kit";
  if (bare.startsWith("/spare-forecast")) return "Spares forecast";
  if (bare.startsWith("/sponsor-renewal-roi")) return "Renewal ROI";
  if (bare.startsWith("/team-health-dashboard")) return "Team health";
  if (bare.startsWith("/sketch-to-brief")) return "Sketch to brief";
  if (bare.startsWith("/scout-assisted-count")) return "Assisted count";
  if (bare.startsWith("/scout-coverage-live")) return "Coverage";
  if (bare.startsWith("/scout-field-budget")) return "Field value";
  if (bare.startsWith("/scout-data-impact")) return "Data impact";
  if (bare.startsWith("/scout-disagreements")) return "Disagreements";
  if (bare.startsWith("/scout-accuracy")) return "Accuracy";
  if (bare.startsWith("/scout-crossval")) return "Cross-check";
  if (bare.startsWith("/rule-impact")) return "Rule impact";
  if (bare.startsWith("/season-planning-workspace")) return "Season plan";
  if (bare.startsWith("/retro")) return "Retro";
  if (bare.startsWith("/tuning-autopilot")) return "Tuning advisor";
  if (bare === "/tuning" || bare.startsWith("/tuning/")) return "Tuning log";
  if (bare.startsWith("/assembly-manual")) return "Assembly manual";
  if (bare.startsWith("/packing")) return "Packing";
  if (bare.startsWith("/batteries")) return "Batteries";
  if (bare.startsWith("/my-day")) return "My Day";
  if (bare.startsWith("/chemistry")) return "Chemistry";
  if (bare.startsWith("/pick-clock")) return "Pick clock";
  if (bare.startsWith("/alliance-selection-desk")) return "Alliance desk";
  if (bare.startsWith("/print-farm")) return "Print farm";
  if (bare.startsWith("/inventory")) return "Inventory";
  if (bare.startsWith("/defense-planner")) return "Defense";
  if (bare.startsWith("/picklist-collab")) return "Pick list";
  if (bare.startsWith("/dossier")) return "Dossier";
  if (bare.startsWith("/event-day-plan")) return "Day plan";
  if (bare.startsWith("/field-reset-timer")) return "Field reset";
  if (bare.startsWith("/drive-team-signals")) return "Drive-team board";
  if (bare.startsWith("/robot-weigh-in")) return "Robot weigh-in";
  if (bare.startsWith("/robot")) return "Robot";
  if (bare.startsWith("/my-kit")) return "My kit";
  if (bare.startsWith("/part-requests")) return "Part requests";
  if (bare.startsWith("/recognition")) return "Recognition";
  if (bare.startsWith("/budget")) return "Season budget";
  if (bare.startsWith("/subteams")) return "Subteam progress";
  if (bare.startsWith("/safety-training")) return "Safety";
  if (bare.startsWith("/safety")) return "Safety";
  if (bare.startsWith("/writer")) return "Writer";
  if (bare.startsWith("/learning")) return "Learning";
  if (bare.startsWith("/training")) return "Training";
  if (bare.startsWith("/tool-checkout")) return "Tool checkout";
  if (bare.startsWith("/goals-tracker")) return "Goals";
  if (bare.startsWith("/goals")) return "Goals";
  if (bare.startsWith("/reimbursements")) return "Reimbursements";
  if (bare.startsWith("/costs")) return "Season costs";
  if (bare.startsWith("/duties")) return "Duties";
  if (bare.startsWith("/announcements")) return "Announcements";
  if (bare.startsWith("/match-delta-watcher")) return "Match-delta watcher";
  if (bare.startsWith("/match-video-index")) return "Match video index";
  if (bare.startsWith("/match-strategy-cards")) return "Match strategy cards";
  if (bare.startsWith("/match-debrief")) return "Match debrief";
  if (bare.startsWith("/match-copilot")) return "Briefing";
  if (bare.startsWith("/event-readiness")) return "Event readiness";
  if (bare.startsWith("/notifications/preferences")) return "Notification preferences";
  if (bare.startsWith("/notifications")) return "Notifications";
  if (bare.startsWith("/forms/") && bare !== "/forms") return "Form";
  if (bare.startsWith("/forms")) return "Forms";
  if (bare.startsWith("/incidents")) return "Safety incidents";
  if (bare.startsWith("/roles")) return "Season roles";
  if (bare.startsWith("/parts-catalog")) return "Parts catalog";
  if (bare.startsWith("/parts-relay")) return "Parts Relay";
  if (bare.startsWith("/account")) return "Account";
  if (bare.startsWith("/alumni-network")) return "Alumni";
  if (bare.startsWith("/auto-routines")) return "Auto routines";
  if (bare.startsWith("/auton-path-library")) return "Auton paths";
  if (bare.startsWith("/bom-cost-rollup")) return "BOM cost";
  if (bare.startsWith("/bringup")) return "Bring-up";
  if (bare.startsWith("/budget-reconciler")) return "Budget check";
  if (bare.startsWith("/bus-factor")) return "Bus factor";
  if (bare.startsWith("/checklist-library")) return "Checklists";
  if (bare.startsWith("/code-perf")) return "Code vs match";
  if (bare.startsWith("/connectors")) return "Connectors";
  if (bare.startsWith("/cross-domain-alerts")) return "Cross-domain alerts";
  if (bare.startsWith("/data-quality-scorecard")) return "Data quality";
  if (bare.startsWith("/decision-critic")) return "Decision critic";
  if (bare.startsWith("/degraded-mode")) return "Data-source health";
  if (bare.startsWith("/district-advancement")) return "Districts";
  if (bare.startsWith("/doc-roles")) return "Document roles";
  if (bare.startsWith("/driver-tryouts")) return "Driver tryouts";
  if (bare.startsWith("/exit-interview")) return "Exit interviews";
  if (bare.startsWith("/gearbox")) return "Gearbox calculator";
  if (bare.startsWith("/incident-heatmap")) return "Incidents";
  if (bare.startsWith("/knowledge-drafts")) return "Knowledge drafts";
  if (bare.startsWith("/leadership")) return "Leadership";
  if (bare.startsWith("/meeting-autopilot")) return "Meeting agenda";
  if (bare.startsWith("/mentor-hours")) return "Mentor hours";
  if (bare.startsWith("/migrate")) return "Bring your season";
  if (bare.startsWith("/mock-judging")) return "Mock judging";
  if (bare.startsWith("/notebook")) return "Engineering notebook";
  if (bare.startsWith("/object-chat-bridge")) return "Object chat";
  if (bare.startsWith("/parents")) return "Parent updates";
  if (bare.startsWith("/power-budget")) return "Power budget";
  if (bare.startsWith("/presence")) return "Presence";
  if (bare.startsWith("/readiness-score")) return "Readiness";
  if (bare.startsWith("/reuse-advisor")) return "Reuse";
  if (bare.startsWith("/reviews")) return "Design reviews";
  if (bare.startsWith("/roadmap")) return "Season roadmap";
  if (bare.startsWith("/search")) return "Search";
  if (bare.startsWith("/season-rollover")) return "Season rollover";
  if (bare.startsWith("/security")) return "Security";
  if (bare.startsWith("/shooter-table")) return "Shooter table";
  if (bare.startsWith("/showcase")) return "Showcase";
  if (bare.startsWith("/skills-graph")) return "Skills";
  if (bare.startsWith("/software-versions")) return "Software versions";
  if (bare.startsWith("/spares")) return "Consumables";
  if (bare.startsWith("/sponsor-tier-calculator")) return "Tier calculator";
  if (bare.startsWith("/standup-digest")) return "Standup";
  if (bare.startsWith("/start")) return "Your path";
  if (bare.startsWith("/subsystems")) return "Subsystem specs";
  if (bare.startsWith("/support")) return "Support";
  if (bare.startsWith("/troubleshoot")) return "Get unstuck";
  if (bare.startsWith("/weight-budget")) return "Weight budget";
  if (bare.startsWith("/whats-new")) return "What’s new";
  if (bare.startsWith("/wiring-diagnoser")) return "Wiring check";
  if (bare === "/wiring" || bare.startsWith("/wiring/")) return "CAN-bus map";
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
