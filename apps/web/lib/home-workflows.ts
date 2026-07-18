/**
 * Student vs mentor home workflows — pure helpers for dashboard strips and
 * first-run checklist glue. FRC identity lives on profiles.team_role (not
 * memberships.role). No demo metrics: empty counts stay empty.
 */

export type HomeAudience = "student" | "mentor";

export type HomeStripItem = {
  key: string;
  label: string;
  detail: string;
  href: string;
  tone: "neutral" | "ok" | "warn";
};

export type MentorHomeStripInput = {
  orgId: string;
  needsAssignment: number;
  lodgingGaps: number;
  unsignedChecklists: number;
};

export type StudentHomeStripInput = {
  orgId: string;
  nextPracticeTitle: string | null;
  nextPracticeAt: string | null;
  hotelName: string | null;
  roomLabel: string | null;
  mineOpenTodos: number;
  kickoffReady: boolean;
};

function withOrg(path: string, orgId: string): string {
  const join = path.includes("?") ? "&" : "?";
  return `${path}${join}orgId=${encodeURIComponent(orgId)}`;
}

/** Coach counts as mentor for ops strips; everyone else gets the student strip. */
export function homeAudienceFromTeamRole(teamRole: string | null | undefined): HomeAudience {
  if (teamRole === "mentor" || teamRole === "coach") return "mentor";
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

export function buildMentorHomeStrip(input: MentorHomeStripInput): HomeStripItem[] {
  const orgId = input.orgId;
  return [
    {
      key: "needs_assignment",
      label: "Needs assignment",
      detail:
        input.needsAssignment > 0
          ? `${input.needsAssignment} open dut${input.needsAssignment === 1 ? "y" : "ies"}`
          : "All upcoming duties assigned",
      href: withOrg("/duties", orgId),
      tone: input.needsAssignment > 0 ? "warn" : "ok",
    },
    {
      key: "lodging_gaps",
      label: "Lodging gaps",
      detail:
        input.lodgingGaps > 0
          ? `${input.lodgingGaps} room${input.lodgingGaps === 1 ? "" : "s"} without an occupant`
          : "No open room slots",
      href: withOrg("/logistics", orgId),
      tone: input.lodgingGaps > 0 ? "warn" : "ok",
    },
    {
      key: "unsigned_checklists",
      label: "Unsigned checklists",
      detail:
        input.unsignedChecklists > 0
          ? `${input.unsignedChecklists} member check${input.unsignedChecklists === 1 ? "" : "s"} still open`
          : "Travel checklists clear",
      href: withOrg("/logistics", orgId),
      tone: input.unsignedChecklists > 0 ? "warn" : "ok",
    },
  ];
}

export function buildStudentHomeStrip(input: StudentHomeStripInput): HomeStripItem[] {
  const orgId = input.orgId;
  const when = formatStripWhen(input.nextPracticeAt);
  const hotel =
    input.hotelName && input.roomLabel
      ? `${input.hotelName} · Room ${input.roomLabel}`
      : input.hotelName
        ? input.hotelName
        : input.roomLabel
          ? `Room ${input.roomLabel}`
          : null;

  return [
    {
      key: "next_practice",
      label: "Next practice",
      detail: input.nextPracticeTitle
        ? when
          ? `${input.nextPracticeTitle} · ${when}`
          : input.nextPracticeTitle
        : "Nothing scheduled yet",
      href: withOrg("/practice", orgId),
      tone: input.nextPracticeTitle ? "ok" : "neutral",
    },
    {
      key: "my_hotel",
      label: "My hotel",
      detail: hotel ?? "No lodging assigned yet",
      href: withOrg("/logistics", orgId),
      tone: hotel ? "ok" : "neutral",
    },
    {
      key: "my_todos",
      label: "My todos",
      detail: input.mineOpenTodos > 0 ? `${input.mineOpenTodos} open` : "You're clear",
      href: withOrg("/todos", orgId),
      tone: input.mineOpenTodos > 0 ? "warn" : "ok",
    },
    {
      key: "kickoff_summary",
      label: "Kickoff summary",
      detail: input.kickoffReady ? "Scoring + priorities ready" : "Open the kickoff worksheet",
      href: withOrg("/kickoff", orgId),
      tone: input.kickoffReady ? "ok" : "neutral",
    },
  ];
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
  const q = `?orgId=${encodeURIComponent(input.orgId)}`;
  return [
    {
      key: "subteam",
      label: "Join a subteam",
      detail: "Pick mechanical, software, or your build crew",
      done: input.joinedSubteam,
      href: `/team/calendar${q}`,
    },
    {
      key: "knowledge",
      label: "Read the knowledge wiki",
      detail: "Robot, strategy, and conventions for your team",
      done: Boolean(input.hasKnowledge),
      href: `/team/knowledge${q}`,
    },
    {
      key: "logistics",
      label: "See logistics",
      detail: "Lodging, travel notes, and day-of checklists",
      done: input.hasLogistics,
      href: `/logistics${q}`,
    },
    {
      key: "kickoff",
      label: "Read kickoff summary",
      detail: "Scoring actions and design priorities",
      done: input.kickoffReady,
      href: `/kickoff${q}`,
    },
    {
      key: "cad_brief",
      label: "Open CAD brief",
      detail: "Turn scouting + research into a design brief",
      done: input.openedCadBrief,
      href: `/cad${q}`,
    },
  ];
}
