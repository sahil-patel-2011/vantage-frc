import { hubPrimaryTabs, hubWorkbenchId, type HubTabDef, type ProductHubDef } from "./hubs";
/**
 * Six sections, like every place. Scouting forms, scout assignments, My Day and Pit TV sit in
 * the place's More tools under Scout, Event day and Our robot.
 */
const COMPETITION_SECTIONS = [
  { id: "scouting", label: "Scout" }, { id: "teams", label: "Teams" },
  // Pick list is its own place at an event (alliance selection), with its own menu entry; the
  // menu used to light up Match plan while the page said Pick list. Match plan no longer
  // carries a second way to the same list when it sits inside Competition.
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
  // The title matches the tab that was pressed ("Robot", not the blueprint's own name).
  const buildSection = hub.id === "build" ? BUILD_SECTIONS.find(section => section.id === tab) : undefined;
  if (buildSection) return buildSection.label;
  return hub.tabs.find(section => section.id === tab)?.label ?? hub.title;
}
