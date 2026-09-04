/**
 * Youth-protection rules for org direct messages.
 *
 * FIRST's Youth Protection Program guidance holds that written communication with a minor should
 * ordinarily be visible to a second adult. Vantage's DMs previously had no such rule, which is the
 * configuration districts ban other chat tools over. These are the pure decision functions; the
 * database enforces the shape (migration 0455_chat_youth_protection.sql) and the API route calls
 * into here so the rule is testable without a database.
 *
 * ROLE, NOT AGE, IS THE SIGNAL WE ACTUALLY HOLD. `profiles.team_role` is collected at onboarding
 * and is the only classification available to a teammate. `profiles.date_of_birth` exists but is
 * self-reported, optional in practice, and readable only by its owner, so it is deliberately not
 * used. Anything that is not an explicit adult role is treated as youth -- the conservative
 * direction.
 */

/** Team roles that count as an adult for the two-adult rule. */
export const ADULT_TEAM_ROLES = ["mentor", "coach", "parent"] as const;

export type ChatMemberClass = "adult" | "youth";

export const DM_MODES = ["open", "supervised", "disabled"] as const;
export type DmMode = (typeof DM_MODES)[number];

/** Supervised is the default on purpose: the safe shape must not require an admin to find it. */
export const DEFAULT_DM_MODE: DmMode = "supervised";

export function normalizeDmMode(value: unknown): DmMode {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  return (DM_MODES as readonly string[]).includes(raw) ? (raw as DmMode) : DEFAULT_DM_MODE;
}

/**
 * Adult iff the member's stated team role is mentor, coach, or parent.
 * `student`, `other`, and an unset role all classify as youth.
 */
export function isAdultTeamRole(teamRole: string | null | undefined): boolean {
  if (typeof teamRole !== "string") return false;
  const tokens = teamRole
    .split(/[\s,|/]+/)
    .map((role) => role.trim().toLowerCase())
    .filter(Boolean);
  if (tokens.includes("student")) return false;
  return tokens.some((role) => (ADULT_TEAM_ROLES as readonly string[]).includes(role));
}

export function classifyTeamRole(teamRole: string | null | undefined): ChatMemberClass {
  return isAdultTeamRole(teamRole) ? "adult" : "youth";
}

export function normalizeChatClass(value: unknown): ChatMemberClass {
  return value === "adult" ? "adult" : "youth";
}

/** A DM needs a second adult only when exactly one side is an adult. */
export function pairNeedsSecondAdult(a: ChatMemberClass, b: ChatMemberClass): boolean {
  return a !== b;
}

export type SupervisorCandidate = {
  userId: string;
  name: string;
  memberRole: string;
  memberSince?: string | null;
};

/**
 * Deterministic pick of the second adult. Candidates arrive already filtered to adult
 * owners/admins and ordered (owner first, then longest-standing). Both DM parties are excluded --
 * the supervisor is by definition someone other than the two people in the room, so an initiator
 * can never supervise their own conversation.
 */
export function pickSupervisor(
  candidates: SupervisorCandidate[],
  excludeUserIds: string[],
): SupervisorCandidate | null {
  const excluded = new Set(excludeUserIds.filter(Boolean));
  const eligible = candidates.filter((candidate) => !excluded.has(candidate.userId));
  if (!eligible.length) return null;
  const ordered = [...eligible].sort((a, b) => {
    const aOwner = a.memberRole === "owner" ? 0 : 1;
    const bOwner = b.memberRole === "owner" ? 0 : 1;
    if (aOwner !== bOwner) return aOwner - bOwner;
    const aSince = a.memberSince ?? "";
    const bSince = b.memberSince ?? "";
    if (aSince !== bSince) return aSince < bSince ? -1 : 1;
    return a.userId < b.userId ? -1 : 1;
  });
  return ordered[0] ?? null;
}

export type DmDecision =
  | { outcome: "allow"; supervisor: null }
  | { outcome: "supervise"; supervisor: SupervisorCandidate }
  | { outcome: "refuse"; supervisor: null; message: string };

export type DmDecisionInput = {
  mode: DmMode;
  initiatorClass: ChatMemberClass;
  peerClass: ChatMemberClass;
  /** Every adult owner/admin in the org, in the order the database returned them. */
  candidates: SupervisorCandidate[];
  /** The two people in the DM. Neither can supervise their own conversation. */
  partyUserIds: string[];
  /** Supervisors already recorded on an existing conversation. */
  existingSupervisorIds?: string[];
};

/**
 * The single decision point for opening or continuing an adult<->youth DM.
 *
 * - youth<->youth and adult<->adult are never affected by this rule.
 * - 'open'       -> unchanged behaviour; the policy screen states plainly what that means.
 * - 'supervised' -> allowed only with a second adult in the room (default).
 * - 'disabled'   -> refused, naming the org policy.
 */
export function decideDm(input: DmDecisionInput): DmDecision {
  if (!pairNeedsSecondAdult(input.initiatorClass, input.peerClass)) {
    return { outcome: "allow", supervisor: null };
  }
  if (input.mode === "open") return { outcome: "allow", supervisor: null };
  if (input.mode === "disabled") {
    return {
      outcome: "refuse",
      supervisor: null,
      message:
        "Your team's chat policy is set to “No adult–student DMs”. Adults and students cannot " +
        "message each other privately here — use the Team channel, or ask an owner or admin to " +
        "change the policy under Chat safety.",
    };
  }
  if (input.existingSupervisorIds?.length) {
    return { outcome: "allow", supervisor: null };
  }
  const supervisor = pickSupervisor(input.candidates, input.partyUserIds);
  if (!supervisor) {
    return {
      outcome: "refuse",
      supervisor: null,
      message:
        "Your team's chat policy requires a second adult in every adult–student private chat, and " +
        "this team has no other adult owner or admin available to be that person. Add a second " +
        "mentor, coach, or parent as an owner or admin, or use the Team channel.",
    };
  }
  return { outcome: "supervise", supervisor };
}

/** Non-dismissible banner text shown to BOTH parties in a supervised DM. */
export function supervisionBadge(supervisorNames: string[]): string {
  const names = supervisorNames.filter(Boolean);
  if (!names.length) return "";
  const list =
    names.length === 1
      ? names[0]!
      : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]!}`;
  return `${list} can read this conversation. Your team requires a second adult in adult–student private chats.`;
}

export const DM_MODE_COPY: Record<DmMode, { label: string; detail: string }> = {
  supervised: {
    label: "Second adult required (recommended)",
    detail:
      "An adult–student private chat is created with another adult owner or admin added to the " +
      "room. Both people see who that is. Student–student and adult–adult chats are untouched. " +
      "If the team has no second adult owner or admin, the chat is refused rather than opened " +
      "unsupervised.",
  },
  disabled: {
    label: "No adult–student DMs",
    detail:
      "Adults and students cannot open a private chat at all. Everything between them happens in " +
      "the Team channel, where the whole team can see it.",
  },
  open: {
    label: "Open DMs (no supervision)",
    detail:
      "Any two members can message privately with no second adult and no visibility rule, " +
      "including an adult and a student. Owners and admins can still export a member's DM " +
      "history, and every export is logged — but nobody is watching in real time. This is the " +
      "configuration many school districts prohibit.",
  },
};
