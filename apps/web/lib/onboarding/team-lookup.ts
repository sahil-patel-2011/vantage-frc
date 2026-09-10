/**
 * Live feedback for the team-number field on onboarding step 2.
 *
 * HONESTY NOTE. There is no endpoint a not-yet-member may call to ask "does FRC
 * team N have a Vantage workspace?" — deliberately, since that would let anyone
 * enumerate which teams are customers. So this model never guesses. It reports
 * only what the server has actually told this session:
 *
 *   - `lockedTeamNumber` / `lockedOrgName` from `GET /api/onboarding` (an invite
 *     or an existing request already bound this account to a real workspace), and
 *   - the outcome of the last submit: `completeOnboarding` calls
 *     `request_workspace_access()`, which raises "No Vantage workspace exists for
 *     FRC team N yet" and is swallowed — so a saved `preferredTeamNumber` that
 *     came back with `accessStatus: "none"` is a real, server-confirmed
 *     "no workspace yet".
 *
 * Anything else is reported as `unchecked`: the number is well-formed and we say
 * plainly that Vantage checks it on submit. We never render "Team 1234 exists"
 * from a guess.
 */

export type TeamLookupAccessStatus =
  | "approved"
  | "invited"
  | "pending"
  | "declined"
  | "withdrawn"
  | "none";

export type TeamLookupKind =
  | "blank"
  | "no_team"
  | "incomplete"
  | "invalid"
  | "locked"
  | "requested"
  | "invited"
  | "declined"
  | "no_workspace"
  | "unchecked";

export type TeamLookupTone = "neutral" | "info" | "good" | "warn" | "error";

export type TeamLookupResult = {
  kind: TeamLookupKind;
  tone: TeamLookupTone;
  /** Parsed number, or null when blank/unparseable. */
  teamNumber: number | null;
  title: string;
  body: string;
  /** False blocks "Continue" — the field needs fixing first. */
  ok: boolean;
  action: { href: string; label: string } | null;
};

export type TeamLookupInput = {
  /** Raw field text, exactly as typed. */
  raw: string;
  /** "I don't have a team number yet" is ticked. */
  noTeam: boolean;
  /** Field is not editable because an invite/request already bound a team. */
  locked?: boolean;
  lockedTeamNumber?: number | null;
  lockedOrgName?: string | null;
  accessStatus?: TeamLookupAccessStatus | null;
  /** `preferredTeamNumber` the server has already stored and acted on. */
  knownTeamNumber?: number | null;
  /** Adults get the /claim path; students are told to ask a mentor. */
  adult?: boolean;
};

export const TEAM_NUMBER_MIN = 1;
export const TEAM_NUMBER_MAX = 99999;

/** Roles that may create a team for a team that has none yet. */
export function isAdultRole(teamRole: string | null | undefined): boolean {
  return teamRole === "mentor" || teamRole === "coach" || teamRole === "parent";
}

/** Digits only, capped at 5 — the inputMode="numeric" field's sanitizer. */
export function sanitizeTeamNumberInput(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, TEAM_NUMBER_MAX.toString().length);
}

/** null when the text is not a usable FRC team number. */
export function parseTeamNumber(raw: string): number | null {
  const digits = raw.trim();
  if (!digits || !/^\d+$/.test(digits)) return null;
  const value = Number(digits);
  if (!Number.isInteger(value)) return null;
  if (value < TEAM_NUMBER_MIN || value > TEAM_NUMBER_MAX) return null;
  return value;
}

function claimAction(adult: boolean | undefined) {
  return adult
    ? { href: "/claim", label: "Claim this team" }
    : null;
}

export function lookupTeamNumber(input: TeamLookupInput): TeamLookupResult {
  const parsed = parseTeamNumber(input.raw);
  const trimmed = input.raw.trim();

  if (input.noTeam) {
    return {
      kind: "no_team",
      tone: "neutral",
      teamNumber: null,
      title: "No team number yet",
      body:
        "You can finish without one. Add a number later in Account and that team still has to approve you — nothing joins you automatically.",
      ok: true,
      action: null,
    };
  }

  if (!trimmed) {
    return {
      kind: "incomplete",
      tone: "neutral",
      teamNumber: null,
      title: "Enter your FRC team number",
      body: `A number between ${TEAM_NUMBER_MIN} and ${TEAM_NUMBER_MAX}. If you don't have one yet, tick the box below.`,
      ok: false,
      action: null,
    };
  }

  if (parsed == null) {
    return {
      kind: "invalid",
      tone: "error",
      teamNumber: null,
      title: "That isn't an FRC team number",
      body: `Expected digits only, ${TEAM_NUMBER_MIN}–${TEAM_NUMBER_MAX}. Enter the number on your robot bumper, not the team name.`,
      ok: false,
      action: null,
    };
  }

  if (input.locked && input.lockedTeamNumber === parsed) {
    return {
      kind: "locked",
      tone: "good",
      teamNumber: parsed,
      title: `${input.lockedOrgName ?? "That workspace"} · Team ${parsed}`,
      body: "This account is already tied to that team through an invitation or an open request, so the number can't change here.",
      ok: true,
      action: null,
    };
  }

  const serverSaw = input.knownTeamNumber != null && input.knownTeamNumber === parsed;

  if (serverSaw && input.accessStatus === "invited") {
    return {
      kind: "invited",
      tone: "good",
      teamNumber: parsed,
      title: `Team ${parsed} already invited you`,
      body: "Finish with the invitation link in your email — that is the fastest way in.",
      ok: true,
      action: { href: "/invite", label: "Open my invite" },
    };
  }

  if (serverSaw && input.accessStatus === "pending") {
    return {
      kind: "requested",
      tone: "info",
      teamNumber: parsed,
      title: `Team ${parsed}'s owners are reviewing you`,
      body: "That workspace exists and your request is already with them. Only they can let you in.",
      ok: true,
      action: null,
    };
  }

  if (serverSaw && input.accessStatus === "declined") {
    return {
      kind: "declined",
      tone: "warn",
      teamNumber: parsed,
      title: `Team ${parsed} did not approve that request`,
      body: "If you picked the wrong number, change it here and submit again.",
      ok: true,
      action: null,
    };
  }

  // Server-confirmed: we asked for this exact number and no workspace was found.
  if (serverSaw && (input.accessStatus === "none" || input.accessStatus == null)) {
    return {
      kind: "no_workspace",
      tone: "warn",
      teamNumber: parsed,
      title: `No Vantage workspace for Team ${parsed} yet`,
      body: input.adult
        ? "Nobody has set this team up. As a mentor, coach, or parent you can claim the number and become its first owner."
        : "Nobody has set this team up yet. Ask a mentor or coach to claim it — students can't create a team.",
      ok: true,
      action: claimAction(input.adult),
    };
  }

  return {
    kind: "unchecked",
    tone: "info",
    teamNumber: parsed,
    title: `This requests Team ${parsed}'s approval`,
    body: "Every owner and admin of that team gets a notification when you submit. Vantage looks the team up then — if no workspace exists yet, it will say so.",
    ok: true,
    action: null,
  };
}
