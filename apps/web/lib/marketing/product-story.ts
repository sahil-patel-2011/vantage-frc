/**
 * Public marketing copy for hubs and tools that actually ship in apps/web.
 * No invented scores, ranks, EPA, or DEMO metrics.
 *
 * Two layers, both real: members navigate the four workspaces in the product
 * chrome, and each workspace opens hub workbenches. Workspace names, order, and
 * hub membership are read from the product nav rather than retyped, so the site
 * cannot describe a drawer the app no longer has (see product-story.test.ts).
 */

import { PRODUCT_WORKSPACES, type ProductWorkspaceId } from "../nav/hubs";
import type { MIconName } from "../../components/marketing/marketing-icons";

export const MARKETING_DEFINITION = {
  kicker: "FIRST Robotics Competition · Invite-only",
  headline: "Your FRC team, in one place.",
  lead:
    "Vantage is operations software for an FRC season: offline scouting, event day, alliance selection, CAD, robot code, calendar, money, and metered AI. One invite-only login. Screens stay empty until TBA, scouting, or a connector has real data.",
} as const;

const WORKSPACE_COPY: Record<ProductWorkspaceId, { icon: MIconName; copy: string }> = {
  scout: {
    icon: "clipboard",
    copy: "Match and pit forms stay on the tablet. QR handoff and pit mesh. Sync when the venue network returns.",
  },
  compete: {
    icon: "flag",
    copy: "Event day, alliance desk, pick clock, and pit repair share one TBA event — or stay empty.",
  },
  build: {
    icon: "wrench",
    copy: "Kickoff, Onshape or Fusion CAD, Code Coach, and inspection. Mutations stay human-gated.",
  },
  "run-season": {
    icon: "calendar",
    copy: "Calendar, chat, hours, budget, sponsors, and grants between the six competition weekends.",
  },
};

/**
 * The four workspaces a member actually sees in the drawer and the bottom
 * island, in shipped order. `hubIds` is what each one opens.
 */
export const MARKETING_WORKSPACES = PRODUCT_WORKSPACES.map((workspace) => ({
  id: workspace.id,
  // The product's own label — never a marketing paraphrase of the nav.
  title: workspace.label,
  icon: WORKSPACE_COPY[workspace.id].icon,
  copy: WORKSPACE_COPY[workspace.id].copy,
  hubIds: workspace.hubs.map((hub) => hub.hubId),
}));

export const MARKETING_HUBS = [
  {
    id: "competition",
    icon: "clipboard" as const,
    title: "Competition",
    href: "/features#competition",
    route: "/competition",
    promise: "Event day, scouting, strategy, and pit — one event context.",
    modules: ["Event day", "Scouting", "Strategy", "Pit"],
    tools: [
      "Command / My Day from TBA match times",
      "Offline match and pit forms with QR handoff",
      "Alliance Selection Desk with scout evidence",
      "Pick clock, pairwise ranking, drive-team tags",
      "Match checklist, pit repair triage, strategy cards",
    ],
  },
  {
    id: "team",
    icon: "users" as const,
    title: "Team",
    href: "/features#team",
    route: "/team",
    promise: "Calendar, chat, people, shop work, and the season playbook.",
    modules: ["Calendar", "Chat", "People", "Work", "Playbook"],
    tools: [
      "Week grid with this team’s TBA matches and GitHub due dates",
      "Org-scoped team chat and DMs",
      "Hours, attendance, FMEA, and battery rotation",
      "Season wiki with a start-season playbook",
      "Bring-your-season import for calendar, hours, and scout CSV",
    ],
  },
  {
    id: "business",
    icon: "coins" as const,
    title: "Business",
    href: "/features#business",
    route: "/business",
    promise: "Money, sponsors, grants, and outreach from recorded rows only.",
    modules: ["Overview", "Money", "Sponsors", "Grants", "Outreach"],
    tools: [
      "Funding sources and purchase log vs season budget",
      "Sponsor pipeline and packages (when sponsors are allowed)",
      "Grant drafts and award essays from org profile",
      "Impact log, fundraisers, and outreach calendar",
    ],
  },
  {
    id: "build",
    icon: "wrench" as const,
    title: "Build",
    href: "/features#build",
    route: "/build",
    promise: "Kickoff, CAD, robot code, and inspection — human-gated.",
    modules: ["Kickoff", "CAD", "Code", "Robot"],
    tools: [
      "Onshape or Fusion CAD after a confirmed brief",
      "Code Coach pattern review and Bugbot scans that quote source",
      "FMEA, batteries, weigh-in, inspection copilot",
      "Power budget and wiring diagnoser from logged circuits",
    ],
  },
  {
    id: "ai",
    icon: "key" as const,
    title: "AI",
    href: "/features#ai",
    route: "/ai",
    promise: "One assistant for the team — write, agent, and settings live inside Ask.",
    modules: ["Ask", "Library", "Settings"],
    tools: [
      "FRC Assistant with TBA, Statbotics cache, and scout facts",
      "Grant and sponsor writer from org profile",
      "Autonomous agent with allowlisted web fetch",
      "Team or personal BYOK, budgets, and usage ledger",
    ],
  },
  {
    id: "media",
    icon: "flag" as const,
    title: "Media",
    href: "/features#media",
    route: "/media",
    promise: "Content calendar, drafts, reminders, and a media kit.",
    modules: ["Calendar", "Drafts", "Reminders", "Kit", "Impact"],
    tools: [
      "Draft captions with metered AI when you opt in",
      "Due reminders for posts you actually scheduled",
      "Kit and impact assets for outreach",
    ],
  },
] as const;

/** "Scout, Compete, Build, and Run season" — for prose that lists the menu. */
export const MARKETING_WORKSPACE_SENTENCE = MARKETING_WORKSPACES.map((workspace, index) =>
  index === MARKETING_WORKSPACES.length - 1 ? `and ${workspace.title}` : workspace.title,
).join(", ");

/**
 * Which workspaces open a hub. Competition answers with two (Scout reaches its
 * scouting workbench, Compete the rest), which is exactly the thing a mentor
 * needs to know before they go looking for it in the menu.
 */
export function marketingWorkspacesForHub(hubId: (typeof MARKETING_HUBS)[number]["id"]): string[] {
  return MARKETING_WORKSPACES.filter((workspace) => workspace.hubIds.includes(hubId)).map(
    (workspace) => workspace.title,
  );
}

export const MARKETING_PROBLEMS = [
  {
    icon: "chat" as const,
    title: "Discord scroll",
    copy: "The decision that mattered is four hundred messages up. In week five nobody can find it, so the team makes it again.",
  },
  {
    icon: "table" as const,
    title: "Six spreadsheets",
    copy: "Scouting in one, the budget in another, the battery log on a laptop in the pit, the pick list on paper at the table.",
  },
  {
    icon: "cap" as const,
    title: "A graduating senior",
    copy: "The person who knows why the intake is geared like that walks out in June, and the reasoning walks out with them.",
  },
] as const;

export const MARKETING_TRUST = [
  {
    icon: "lock" as const,
    title: "Invite-only",
    copy: "Owners invite exact emails. There is no public team directory and no demo workspace.",
  },
  {
    icon: "shield" as const,
    title: "Sourced or empty",
    copy: "Screens stay blank until TBA, scouting, or a connector has real rows. No fabricated EPA or win rates.",
  },
  {
    icon: "wifi" as const,
    title: "Works offline",
    copy: "Match and pit forms stay on the tablet. QR handoff and pit mesh cover other devices, then sync.",
  },
] as const;

export const MARKETING_MENU = [
  {
    title: "Logistics",
    copy: "Hotels, travel legs, packing lists, on-duty mentors, and shop-tour invites. Reached from search rather than a menu row, and empty until you add them.",
  },
  {
    title: "Exports",
    copy: "Audited CSV and ZIP takeout for the org. Team AI chats stay org-scoped. Keys are never included.",
  },
  {
    title: "Desktop",
    copy: "Windows window around the hosted workspace. Fusion CAD still uses the local relay. Unsigned until certs.",
  },
] as const;

export const MARKETING_SEASON = [
  {
    title: "Shop weeks",
    copy: "Calendar, playbook, CAD briefs, Code Coach, FMEA, and batteries — between events, not only on Saturday.",
  },
  {
    title: "Before you load in",
    copy: "Publish scout forms, set the active event, pack lists, travel, and match checklist from TBA alliances.",
  },
  {
    title: "At the venue",
    copy: "Offline scouting, pit mesh, Command / My Day, strategy cards, and pit repair triage share that event.",
  },
  {
    title: "Alliance selection",
    copy: "Alliance desk, pick list, pairwise, and tags use scout evidence plus public facts — or stay empty.",
  },
] as const;
