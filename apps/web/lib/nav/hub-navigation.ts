import { hubPrimaryTabs, hubWorkbenchId, type HubTabDef, type ProductHubDef } from "./hubs";
const COMPETITION_SECTIONS = [
  { id: "scouting", label: "Scout" }, { id: "teams", label: "Teams" },
  { id: "strategy", label: "Match plan" }, { id: "picks", label: "Pick list" },
  { id: "command", label: "Event day" }, { id: "match-checklist", label: "Our robot" },
];
/**
 * "Robot" opens the robot: the blueprint, with its subsystems and its links to failures,
 * batteries, weigh-in and inspection. It used to open the workbench root, the failure log,
 * so a page titled Robot was a "Log a failure" form.
 */
const BUILD_SECTIONS = [
  { id: "kickoff", label: "Kickoff" }, { id: "cad", label: "CAD" },
  { id: "code", label: "Code" }, { id: "robot", label: "Robot" },
];
/** Each event task has one home. Permission roots are unchanged. */
export function hubNavigationSections(hub: ProductHubDef, permitted: readonly HubTabDef[]) {
  const allowed = new Set(permitted.map(entry => entry.id));
  const sections = hub.id === "competition" ? COMPETITION_SECTIONS : hub.id === "build" ? BUILD_SECTIONS : hubPrimaryTabs(hub);
  return sections.filter(entry => allowed.has(entry.id) && allowed.has(hubWorkbenchId(hub, entry.id)));
}
/** A page says what it does; destination selection belongs to the main menu. */
export function hubPageTitle(hub: ProductHubDef, tab: string): string {
  if (hub.id === "competition") {
    return COMPETITION_SECTIONS.find(section => section.id === tab)?.label ?? hub.tabs.find(section => section.id === tab)?.label ?? hub.title;
  }
  // The Robot workbench root is the failure log; its page says so (Team › Work calls it the same).
  if (hub.id === "build" && tab === "fmea") return "Failure notes";
  return hub.tabs.find(section => section.id === tab)?.label ?? hub.title;
}
/** Common follow-up actions instead of a second navigation catalog. */
export const CONTEXT_ACTIONS: Record<string, readonly { id: string; label: string }[]> = {
  "competition:command": [{ id: "schedule", label: "Full schedule" }, { id: "event-day-plan", label: "Plan travel and duties" }],
  "competition:scouting": [{ id: "forms", label: "Edit forms" }, { id: "scout-coverage-live", label: "Assign scouts" }, { id: "scout-training-mode", label: "Practice scouting" }],
  "competition:strategy": [{ id: "briefing", label: "Open match briefing" }, { id: "alliance-sim", label: "Try an alliance" }],
  "competition:picks": [{ id: "alliance-selection-desk", label: "Run alliance selection" }],
  "competition:match-checklist": [{ id: "pit", label: "Robot status" }, { id: "pit-repair-triage", label: "Log a repair" }, { id: "battery-rotation", label: "Charge plan" }],
  "team:calendar": [{ id: "logistics", label: "Plan travel" }, { id: "duties", label: "Assign duties" }],
  "team:messages": [{ id: "announcements", label: "Post an announcement" }],
  "team:attendance": [{ id: "hours-self-view", label: "My hours" }, { id: "learning", label: "Learning" }],
  "team:todos": [{ id: "season-planning-workspace", label: "Plan the season" }, { id: "practice", label: "Plan practice" }],
  "team:knowledge": [{ id: "writer", label: "Write a draft" }, { id: "decisions", label: "Team decisions" }],
  "business:finance": [{ id: "season-budget", label: "Set season budget" }, { id: "orders", label: "Purchase orders" }, { id: "reimbursements", label: "Reimbursements" }],
  "business:sponsors": [{ id: "sponsorship", label: "Sponsorship packages" }, { id: "sponsor-wall", label: "Sponsor wall" }],
  "business:grants": [{ id: "grant-calendar", label: "Grant deadlines" }, { id: "grant-report", label: "Grant reports" }],
  "business:evidence": [{ id: "fundraisers", label: "Fundraisers" }, { id: "awards-workbench", label: "Prepare awards" }],
  "build:cad": [{ id: "cad-vault", label: "CAD files" }, { id: "cad-learn", label: "Learn CAD" }],
  "build:code": [{ id: "troubleshoot", label: "Troubleshoot the robot" }, { id: "code-deploy-log", label: "Deployment history" }],
  "build:fmea": [{ id: "robot", label: "Robot blueprint" }, { id: "manufacturing", label: "Manufacturing" }, { id: "batteries", label: "Batteries" }],
  "ai:budgets": [{ id: "connections", label: "Connect AI" }, { id: "governance", label: "AI policy" }, { id: "usage", label: "Usage" }],
};
