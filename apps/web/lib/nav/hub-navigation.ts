import { hubPrimaryTabs, hubWorkbenchId, type HubTabDef, type ProductHubDef } from "./hubs";
/**
 * A place shows the few sections people open every day; everything else is in its More tools
 * (components/hub-sections.tsx), grouped under the section it belongs to, and in search.
 *
 * Competition is the three things a team does at an event: scout, plan the match, run the day.
 * Teams and the pick list are part of planning (Match plan has its own Pick lists tab); Our
 * robot, My Day and Pit TV are part of the day.
 */
const COMPETITION_SECTIONS = [
  { id: "scouting", label: "Scout" },
  { id: "strategy", label: "Match plan" },
  { id: "command", label: "Event day" },
];
/** Playbook and the team's resources are in More tools; these four are the weekly routine. */
const TEAM_SECTIONS = [
  { id: "calendar", label: "Calendar" }, { id: "messages", label: "Chat" },
  { id: "attendance", label: "People" }, { id: "todos", label: "Tasks" },
];
/** Grants, Outreach and Awards are seasonal and live in More tools. */
const BUSINESS_SECTIONS = [
  { id: "overview", label: "Overview" }, { id: "finance", label: "Money" }, { id: "sponsors", label: "Sponsors" },
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
  const sections =
    hub.id === "competition" ? COMPETITION_SECTIONS
    : hub.id === "build" ? BUILD_SECTIONS
    : hub.id === "team" ? TEAM_SECTIONS
    : hub.id === "business" ? BUSINESS_SECTIONS
    : hubPrimaryTabs(hub);
  return sections.filter(entry => allowed.has(entry.id) && allowed.has(hubWorkbenchId(hub, entry.id)));
}
/** A page says what it does; destination selection belongs to the main menu. */
export function hubPageTitle(hub: ProductHubDef, tab: string): string {
  if (hub.id === "competition") {
    return COMPETITION_SECTIONS.find(section => section.id === tab)?.label ?? hub.tabs.find(section => section.id === tab)?.label ?? hub.title;
  }
  // The Robot workbench root is the failure log; its page says so (Team › Work calls it the same).
  if (hub.id === "build" && tab === "fmea") return "Failure notes";
  // The title matches the tab that was pressed ("Robot", not the blueprint's own name).
  const buildSection = hub.id === "build" ? BUILD_SECTIONS.find(section => section.id === tab) : undefined;
  if (buildSection) return buildSection.label;
  return hub.tabs.find(section => section.id === tab)?.label ?? hub.title;
}
