import { hubHref } from "../nav/hubs";

/** Soft-UI related Team hub surfaces (never DEMO placeholders). */
export const TEAM_HUB_RELATED_LINKS = [
  { id: "calendar", label: "Calendar & subteams" },
  { id: "practice", label: "Practice" },
  { id: "attendance", label: "Attendance" },
  { id: "knowledge", label: "Knowledge" },
  { id: "messages", label: "Messages" },
  { id: "todos", label: "Todos" },
  { id: "batteries", label: "Batteries" },
  { id: "fmea", label: "FMEA" },
] as const;

export type TeamHubRelatedId = (typeof TEAM_HUB_RELATED_LINKS)[number]["id"];

export type TeamHubRelatedLink = {
  id: TeamHubRelatedId;
  label: string;
  href: string;
};

/** Messages Soft-UI strip: ops surfaces people discuss in chat. */
export const MESSAGES_RELATED_INCLUDE: TeamHubRelatedId[] = [
  "calendar",
  "todos",
  "attendance",
  "knowledge",
];

/** Cross-links for Team Soft-UI (never DEMO placeholders). */
export function teamHubRelatedLinks(
  orgId?: string | null,
  options?: { active?: TeamHubRelatedId; include?: TeamHubRelatedId[] },
): TeamHubRelatedLink[] {
  const byId = new Map(TEAM_HUB_RELATED_LINKS.map((link) => [link.id, link]));
  const source = options?.include
    ? options.include.map((id) => byId.get(id)).filter((link): link is (typeof TEAM_HUB_RELATED_LINKS)[number] => Boolean(link))
    : [...TEAM_HUB_RELATED_LINKS];

  return source
    .filter((link) => link.id !== options?.active)
    .map((link) => ({
      id: link.id,
      label: link.label,
      href: hubHref("/team", link.id, orgId),
    }));
}
