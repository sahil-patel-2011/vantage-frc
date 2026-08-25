import { githubConnectionHref } from "../github/github-related";
import { hubHref } from "../nav/hubs";

export const TEAM_HQ_IDS = ["calendar", "messages", "knowledge", "github"] as const;
export type TeamHqId = (typeof TEAM_HQ_IDS)[number];

export type TeamHqLink = {
  id: TeamHqId;
  label: string;
  detail: string;
  href: string;
};

/**
 * Calendar · Chat · Playbook · GitHub — the four surfaces every member hits
 * during a season. Never DEMO destinations.
 */
export function teamHqLinks(orgId?: string | null, active?: TeamHqId): TeamHqLink[] {
  const links: TeamHqLink[] = [
    {
      id: "calendar",
      label: "Calendar",
      detail: "Shop nights, meetings, events",
      href: hubHref("/team", "calendar", orgId),
    },
    {
      id: "messages",
      label: "Team chat",
      detail: "Discuss the next meeting",
      href: hubHref("/team", "messages", orgId),
    },
    {
      id: "knowledge",
      label: "Playbook",
      detail: "Before / build / competition / after",
      href: hubHref("/team", "knowledge", orgId),
    },
    {
      id: "github",
      label: "GitHub",
      detail: "Connect robot-code",
      href: githubConnectionHref(orgId),
    },
  ];
  return active ? links.filter((link) => link.id !== active) : links;
}
