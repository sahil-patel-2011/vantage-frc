/**
 * Student vs mentor home workflows — pure helpers for dashboard strips and
 * first-run checklist glue. FRC identity lives on profiles.team_role (not
 * memberships.role). No demo metrics: empty counts stay empty.
 */

import { hubHref } from "./nav/hubs";
import { withOrgHref } from "./nav/product-nav";

export type HomeAudience = "student" | "mentor";

export type HomeStripItem = {
  key: string;
  label: string;
  detail: string;
  href: string;
  tone: "neutral" | "ok" | "warn";
  /** Real schedule ISO for a live Soft-UI countdown — omit when unknown (never DEMO). */
  at?: string | null;
};

export type MentorHomeStripInput = {
  orgId: string;
  needsAssignment: number;
  lodgingGaps: number;
  unsignedChecklists: number;
  /** Scheduled/draft visits missing a host — never DEMO invite counts. */
  visitHostGaps?: number;
};

export type StudentHomeStripInput = {
  orgId: string;
  nextPracticeTitle: string | null;
  nextPracticeAt: string | null;
  hotelName: string | null;
  roomLabel: string | null;
  /** Next published travel leg title/when — never DEMO departures. */
  nextTravelLabel?: string | null;
  nextTravelAt?: string | null;
  mineOpenTodos: number;
  kickoffReady: boolean;
};

/** Coach counts as mentor for ops strips; everyone else gets the student strip. */
export function homeAudienceFromTeamRole(teamRole: string | null | undefined): HomeAudience {
  const tokens = String(teamRole ?? "")
    .split(/[\s,|/]+/)
    .map((role) => role.trim().toLowerCase());
  if (tokens.some((role) => role === "mentor" || role === "coach")) return "mentor";
  return "student";
}

export function formatStripWhen(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Lodging clarity for Soft-UI strips — real hotel/room only. */
export function formatHomeLodgingDetail(
  hotelName: string | null | undefined,
  roomLabel: string | null | undefined,
): string {
  const hotel = hotelName?.trim() || null;
  const room = roomLabel?.trim() || null;
  if (hotel && room) return `${hotel} · Room ${room}`;
  if (hotel) return hotel;
  if (room) return `Room ${room}`;
  return "No lodging assigned yet";
}

export function buildMentorHomeStrip(input: MentorHomeStripInput): HomeStripItem[] {
  const orgId = input.orgId;
  const hostGaps = input.visitHostGaps ?? 0;
  const items: HomeStripItem[] = [
    {
      key: "needs_assignment",
      label: "Needs assignment",
      detail:
        input.needsAssignment > 0
          ? `${input.needsAssignment} open dut${input.needsAssignment === 1 ? "y" : "ies"}`
          : "All upcoming duties assigned",
      href: withOrgHref("/duties", orgId),
      tone: input.needsAssignment > 0 ? "warn" : "ok",
    },
    {
      key: "lodging_gaps",
      label: "Lodging gaps",
      detail:
        input.lodgingGaps > 0
          ? `${input.lodgingGaps} room${input.lodgingGaps === 1 ? "" : "s"} without an occupant`
          : "No open room slots",
      href: withOrgHref("/logistics", orgId),
      tone: input.lodgingGaps > 0 ? "warn" : "ok",
    },
    {
      key: "unsigned_checklists",
      label: "Unsigned checklists",
      detail:
        input.unsignedChecklists > 0
          ? `${input.unsignedChecklists} member check${input.unsignedChecklists === 1 ? "" : "s"} still open`
          : "Travel checklists clear",
      href: withOrgHref("/logistics", orgId),
      tone: input.unsignedChecklists > 0 ? "warn" : "ok",
    },
  ];

  if (hostGaps > 0) {
    items.push({
      key: "visit_hosts",
      label: "Visit hosts",
      detail: `${hostGaps} visit${hostGaps === 1 ? "" : "s"} missing a mentor host`,
      href: withOrgHref("/visit-invites", orgId),
      tone: "warn",
    });
  } else {
    items.push({
      key: "event_day",
      label: "Event Day",
      detail: "Field command, travel strip, and match queue",
      href: hubHref("/competition", "command", orgId),
      tone: "neutral",
    });
  }

  return items;
}

export function buildStudentHomeStrip(input: StudentHomeStripInput): HomeStripItem[] {
  const orgId = input.orgId;
  const hotel = formatHomeLodgingDetail(input.hotelName, input.roomLabel);
  const practiceDetail = input.nextPracticeTitle?.trim() || "Nothing scheduled yet";
  const travelDetail = input.nextTravelLabel?.trim() || "No leave time published yet";

  return [
    {
      key: "next_practice",
      label: "Next practice",
      detail: practiceDetail,
      href: withOrgHref("/practice", orgId),
      tone: input.nextPracticeTitle ? "ok" : "neutral",
      at: input.nextPracticeAt,
    },
    {
      key: "my_hotel",
      label: "My hotel",
      detail: hotel,
      href: withOrgHref("/logistics", orgId),
      tone: hotel !== "No lodging assigned yet" ? "ok" : "neutral",
    },
    {
      key: "next_travel",
      label: "Next leave",
      detail: travelDetail,
      href: withOrgHref("/logistics", orgId),
      tone: input.nextTravelLabel ? "ok" : "neutral",
      at: input.nextTravelAt,
    },
    {
      key: "my_todos",
      label: "My todos",
      detail: input.mineOpenTodos > 0 ? `${input.mineOpenTodos} open` : "You're clear",
      href: withOrgHref("/todos", orgId),
      tone: input.mineOpenTodos > 0 ? "warn" : "ok",
    },
    {
      key: "kickoff_summary",
      label: "Kickoff summary",
      detail: input.kickoffReady ? "Scoring + priorities ready" : "Open the kickoff worksheet",
      href: hubHref("/build", "kickoff", orgId),
      tone: input.kickoffReady ? "ok" : "neutral",
    },
  ];
}

/** Prefer warnings and timed cues so Home first viewport stays lean. */
export function prioritizeHomeStrip(items: HomeStripItem[], max = 3): HomeStripItem[] {
  if (items.length <= max) return items;
  const score = (item: HomeStripItem) =>
    (item.tone === "warn" ? 8 : 0) + (item.at ? 4 : 0) + (item.tone === "ok" ? 1 : 0);
  return [...items].sort((a, b) => score(b) - score(a)).slice(0, max);
}

export type FirstRunStep = {
  key: string;
  label: string;
  detail: string;
  done: boolean;
  href: string;
};

/** Additive first-run steps: subteam calendar → wiki → logistics → kickoff → CAD. */
export function buildSeasonFirstRunSteps(input: {
  orgId: string;
  joinedSubteam: boolean;
  hasKnowledge?: boolean;
  hasLogistics: boolean;
  kickoffReady: boolean;
  openedCadBrief: boolean;
}): FirstRunStep[] {
  const orgId = input.orgId;
  return [
    {
      key: "subteam",
      label: "Join a subteam",
      detail: "Pick mechanical, software, or your build crew",
      done: input.joinedSubteam,
      href: withOrgHref("/team/calendar", orgId),
    },
    {
      key: "knowledge",
      label: "Read the knowledge wiki",
      detail: "Robot, strategy, and conventions for your team",
      done: Boolean(input.hasKnowledge),
      href: withOrgHref("/team/knowledge", orgId),
    },
    {
      key: "logistics",
      label: "See logistics",
      detail: "Lodging, travel notes, and day-of checklists",
      done: input.hasLogistics,
      href: withOrgHref("/logistics", orgId),
    },
    {
      key: "kickoff",
      label: "Read kickoff summary",
      detail: "Scoring actions and design priorities",
      done: input.kickoffReady,
      href: hubHref("/build", "kickoff", orgId),
    },
    {
      key: "cad_brief",
      label: "Open CAD brief",
      detail: "Turn scouting + research into a design brief",
      done: input.openedCadBrief,
      href: withOrgHref("/cad", orgId),
    },
  ];
}
