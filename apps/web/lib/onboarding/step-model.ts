/**
 * Pure step model for `/onboarding`.
 *
 * The three screens map 1:1 onto the server's draft steps, so the wire contract
 * is unchanged — only what is asked on each screen moved:
 *
 *   profile     → "You":        name, role, crew, and the two account fields the
 *                               server requires (date of birth + gender).
 *   team        → "Your team":  team number + focus (+ org fields for team heads).
 *   preferences → "Finish":     display name, appearance, both consents, submit.
 *
 * Role and crew are *collected* on screen 1 but *saved* with the step-2 PATCH,
 * because `PATCH { step: "profile" }` is `.strict()` and accepts only the four
 * profile fields. Nothing is dropped: the draft below holds them across the step.
 *
 * Everything here is a pure function over one draft object, so back navigation
 * cannot lose state — going back never rewrites the draft.
 */

import {
  ONBOARDING_SETUP_STEPS,
  type OnboardingFlowStep,
  type OnboardingSetupStep,
  type TeamAffiliationOption,
} from "./onboarding-flow";
import { lookupTeamNumber, parseTeamNumber, type TeamLookupAccessStatus } from "./team-lookup";
import { isFundingModel, type FundingModel } from "../funding-profile";

export type OnboardingRole = "student" | "mentor" | "coach" | "parent" | "other";
export type OnboardingCrew =
  | "scout"
  | "driver"
  | "operator"
  | "mechanical"
  | "electrical"
  | "programming"
  | "cad"
  | "pit"
  | "business"
  | "other";
export type OnboardingFocus = "competition" | "build" | "business" | "leadership";
export type OnboardingGender = "female" | "male" | "non_binary" | "prefer_not_to_say" | "other";

export type OnboardingDraft = {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  gender: OnboardingGender;
  teamRole: OnboardingRole;
  crewRole: OnboardingCrew | "";
  roleDescription: string;
  teamNumber: string;
  noTeam: boolean;
  primaryFocus: OnboardingFocus;
  displayName: string;
  themePreference: "light" | "dark";
  orgCity: string;
  orgStateProv: string;
  orgDescription: string;
  teamAffiliation: TeamAffiliationOption | "";
  fundingModel: FundingModel | "";
  schoolFunded: boolean;
  outsideGrants: boolean;
  sponsorsAllowed: boolean;
  termsAccepted: boolean;
  privacyAccepted: boolean;
};

export type OnboardingStepContext = {
  isTeamHead: boolean;
  /** Both consent documents still need ticking. */
  legalNeeded: boolean;
  locked: boolean;
  lockedTeamNumber?: number | null;
  lockedOrgName?: string | null;
  accessStatus?: TeamLookupAccessStatus | null;
  knownTeamNumber?: number | null;
};

export type StepValidation =
  | { ok: true }
  | { ok: false; field: string; message: string };

export function emptyOnboardingDraft(): OnboardingDraft {
  return {
    firstName: "",
    lastName: "",
    dateOfBirth: "",
    gender: "prefer_not_to_say",
    teamRole: "student",
    crewRole: "",
    roleDescription: "",
    teamNumber: "",
    noTeam: false,
    primaryFocus: "competition",
    displayName: "",
    themePreference: "light",
    orgCity: "",
    orgStateProv: "",
    orgDescription: "",
    teamAffiliation: "",
    fundingModel: "",
    schoolFunded: false,
    outsideGrants: false,
    sponsorsAllowed: true,
    termsAccepted: false,
    privacyAccepted: false,
  };
}

/**
 * Sensible focus for someone who just picked a role and crew. Only ever used as
 * a pre-selection the person can change on screen 2 — never silently submitted
 * without being shown.
 */
export function defaultFocusForRole(
  teamRole: OnboardingRole | null | undefined,
  crewRole: OnboardingCrew | "" | null | undefined,
): OnboardingFocus {
  switch (crewRole) {
    case "scout":
    case "driver":
    case "operator":
    case "pit":
      return "competition";
    case "mechanical":
    case "electrical":
    case "programming":
    case "cad":
      return "build";
    case "business":
      return "business";
    default:
      break;
  }
  if (teamRole === "coach") return "leadership";
  if (teamRole === "parent" || teamRole === "mentor") return "leadership";
  return "competition";
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function validateProfileStep(draft: OnboardingDraft): StepValidation {
  if (!draft.firstName.trim()) {
    return { ok: false, field: "firstName", message: "Add your first name." };
  }
  if (!draft.lastName.trim()) {
    return { ok: false, field: "lastName", message: "Add your last name." };
  }
  if (!draft.teamRole) {
    return { ok: false, field: "teamRole", message: "Pick the card that matches your role." };
  }
  // Required by the account system, not by us — kept on screen 1 with that reason
  // shown, because `POST /api/onboarding` rejects the submit without them.
  if (!ISO_DATE.test(draft.dateOfBirth)) {
    return {
      ok: false,
      field: "dateOfBirth",
      message: "Your date of birth is required for youth-safe account records. Teammates never see it.",
    };
  }
  return { ok: true };
}

function validateTeamStep(draft: OnboardingDraft, context: OnboardingStepContext): StepValidation {
  const lookup = lookupTeamNumber({
    raw: draft.teamNumber,
    noTeam: draft.noTeam,
    locked: context.locked,
    lockedTeamNumber: context.lockedTeamNumber,
    lockedOrgName: context.lockedOrgName,
    accessStatus: context.accessStatus,
    knownTeamNumber: context.knownTeamNumber,
  });
  if (!lookup.ok) {
    return { ok: false, field: "teamNumber", message: lookup.body };
  }
  if (context.isTeamHead) {
    if (!draft.teamAffiliation) {
      return {
        ok: false,
        field: "teamAffiliation",
        message: "Pick how your team is affiliated (private school, public school, or community).",
      };
    }
    if (!isFundingModel(draft.fundingModel)) {
      return {
        ok: false,
        field: "funding",
        message: "Pick how the team is funded: yourselves, the school, sponsors, or both.",
      };
    }
  }
  return { ok: true };
}

function validateFinishStep(draft: OnboardingDraft, context: OnboardingStepContext): StepValidation {
  if (context.isTeamHead) {
    if (!draft.orgCity.trim() || !draft.orgStateProv.trim()) {
      return {
        ok: false,
        field: "orgCity",
        message: "Add your team's city and state so sponsors and partners know where you compete from.",
      };
    }
  }
  if (context.legalNeeded && !(draft.termsAccepted && draft.privacyAccepted)) {
    return {
      ok: false,
      field: "legal",
      message: "Agree to the Terms of Service and the Privacy Policy to submit.",
    };
  }
  return { ok: true };
}

/** Gate for leaving `step`. Never mutates the draft. */
export function validateOnboardingStep(
  step: OnboardingSetupStep,
  draft: OnboardingDraft,
  context: OnboardingStepContext,
): StepValidation {
  switch (step) {
    case "profile":
      return validateProfileStep(draft);
    case "team":
      return validateTeamStep(draft, context);
    case "preferences":
      return validateFinishStep(draft, context);
  }
}

export function nextOnboardingStep(step: OnboardingSetupStep): OnboardingSetupStep | null {
  const index = ONBOARDING_SETUP_STEPS.indexOf(step);
  return ONBOARDING_SETUP_STEPS[index + 1] ?? null;
}

export function previousOnboardingStep(step: OnboardingFlowStep): OnboardingSetupStep | null {
  // From the pending panel, "change my answers" returns to the team screen.
  if (step === "pending") return "team";
  if (step === "done") return null;
  const index = ONBOARDING_SETUP_STEPS.indexOf(step);
  if (index <= 0) return null;
  return ONBOARDING_SETUP_STEPS[index - 1] ?? null;
}

export type OnboardingStepState = {
  step: OnboardingFlowStep;
  draft: OnboardingDraft;
  error: string | null;
  errorField: string | null;
};

/**
 * Try to move forward. A failing gate keeps the step *and the whole draft*, and
 * reports which field to focus. `submit` marks the last step — the caller does
 * the network call and then routes to pending/done.
 */
export function onboardingAdvance(
  state: OnboardingStepState,
  context: OnboardingStepContext,
): OnboardingStepState & { submit: boolean } {
  if (state.step === "pending" || state.step === "done") {
    return { ...state, submit: false };
  }
  const result = validateOnboardingStep(state.step, state.draft, context);
  if (!result.ok) {
    return {
      step: state.step,
      draft: state.draft,
      error: result.message,
      errorField: result.field,
      submit: false,
    };
  }
  const next = nextOnboardingStep(state.step);
  if (!next) {
    return { step: state.step, draft: state.draft, error: null, errorField: null, submit: true };
  }
  return { step: next, draft: state.draft, error: null, errorField: null, submit: false };
}

/** Back never validates and never rewrites the draft. */
export function onboardingGoBack(state: OnboardingStepState): OnboardingStepState {
  const previous = previousOnboardingStep(state.step);
  if (!previous) return { ...state, error: null, errorField: null };
  return { step: previous, draft: state.draft, error: null, errorField: null };
}

/** The number the server should be sent, honouring lock + "no team yet". */
export function submittedTeamNumber(
  draft: OnboardingDraft,
  context: Pick<OnboardingStepContext, "locked" | "lockedTeamNumber" | "isTeamHead">,
): number | null {
  if (context.locked && context.lockedTeamNumber != null) return context.lockedTeamNumber;
  if (draft.noTeam) return null;
  return parseTeamNumber(draft.teamNumber);
}

/* ------------------------------------------------------------------ *
 * Pending-approval state: what happens next, who heard about it, and
 * what you can do while you wait.
 * ------------------------------------------------------------------ */

export type PendingStage = {
  key: string;
  title: string;
  detail: string;
  phase: "done" | "current" | "upcoming";
};

export type PendingMeanwhileLink = { href: string; label: string; detail: string };

export type OnboardingPendingPlan = {
  kind: "pending" | "invited" | "declined" | "no_workspace" | "no_team";
  eyebrow: string;
  headline: string;
  /** Who actually received a notification — empty string when nobody did. */
  notified: string;
  stages: PendingStage[];
  meanwhile: PendingMeanwhileLink[];
  primaryAction: { kind: "check" | "edit" | "invite" | "claim"; label: string };
};

const MEANWHILE_BASE: PendingMeanwhileLink[] = [
  {
    href: "/docs",
    label: "Read the Vantage docs",
    detail: "How scouting, strategy, and the AI tools fit together before your first meeting.",
  },
  {
    href: "/roadmap",
    label: "See what's shipping",
    detail: "The public roadmap for the current season.",
  },
  {
    href: "/account",
    label: "Finish your account",
    detail: "Add a display name, appearance, and notification preferences.",
  },
  {
    href: "/security",
    label: "Turn on two-factor",
    detail: "Enrol an authenticator now so event day isn't the first time you try.",
  },
];

export function buildOnboardingPendingPlan(input: {
  accessStatus: TeamLookupAccessStatus | null | undefined;
  teamNumber: number | null;
  orgName: string | null;
  adult: boolean;
}): OnboardingPendingPlan {
  const teamLabel = input.orgName ?? (input.teamNumber ? `FRC Team ${input.teamNumber}` : "your team");

  if (input.accessStatus === "invited") {
    return {
      kind: "invited",
      eyebrow: "INVITATION READY",
      headline: `${teamLabel} already invited you`,
      notified: "",
      stages: [
        { key: "profile", title: "Profile saved", detail: "Your name, role, and crew are stored privately.", phase: "done" },
        { key: "invite", title: "Open the invitation email", detail: "Its link finishes the join — this page can't do it for you.", phase: "current" },
        { key: "in", title: "You're in", detail: "The invite drops you straight into the team.", phase: "upcoming" },
      ],
      meanwhile: MEANWHILE_BASE,
      primaryAction: { kind: "invite", label: "Open my invite" },
    };
  }

  if (input.accessStatus === "declined") {
    return {
      kind: "declined",
      eyebrow: "REQUEST NEEDS ATTENTION",
      headline: `${teamLabel} did not approve this request`,
      notified: "",
      stages: [
        { key: "profile", title: "Profile saved", detail: "Nothing was deleted — only the team request was declined.", phase: "done" },
        { key: "fix", title: "Check the team number", detail: "The most common cause is a number that belongs to a different team.", phase: "current" },
        { key: "resubmit", title: "Ask again", detail: "Submitting sends a fresh request to that team's owners.", phase: "upcoming" },
      ],
      meanwhile: MEANWHILE_BASE,
      primaryAction: { kind: "edit", label: "Update my request" },
    };
  }

  // Server accepted the profile but found no workspace for that number.
  if (input.accessStatus === "none" && input.teamNumber) {
    return {
      kind: "no_workspace",
      eyebrow: "NO WORKSPACE YET",
      headline: `Nobody has set up Team ${input.teamNumber} on Vantage`,
      notified: "",
      stages: [
        { key: "profile", title: "Profile saved", detail: "You're signed up — you just aren't attached to a team.", phase: "done" },
        {
          key: "claim",
          title: input.adult ? "Claim the team number" : "Ask a mentor or coach to claim it",
          detail: input.adult
            ? "Adults on the team can create the team and become its first owner."
            : "Students can't create a team. An adult claims it, then invites you.",
          phase: "current",
        },
        { key: "join", title: "Join once it exists", detail: "You'll get an exact-email invite, or you can request approval again.", phase: "upcoming" },
      ],
      meanwhile: MEANWHILE_BASE,
      primaryAction: input.adult ? { kind: "claim", label: "Claim this team" } : { kind: "edit", label: "Change the team number" },
    };
  }

  if (!input.teamNumber) {
    return {
      kind: "no_team",
      eyebrow: "PROFILE COMPLETE",
      headline: "You're set up — you just haven't joined a team",
      notified: "",
      stages: [
        { key: "profile", title: "Profile saved", detail: "Your role and crew are stored privately.", phase: "done" },
        { key: "team", title: "Join a team when you're ready", detail: "Use an invite link, or add a team number so their owners can approve you.", phase: "current" },
        { key: "approve", title: "That team decides", detail: "Knowing a team number never opens someone else's workspace.", phase: "upcoming" },
      ],
      meanwhile: MEANWHILE_BASE,
      primaryAction: { kind: "edit", label: "Add a team number" },
    };
  }

  return {
    kind: "pending",
    eyebrow: "AWAITING THAT TEAM'S APPROVAL",
    headline: `${teamLabel} is reviewing your request`,
    notified: "Every owner and admin on that team got an in-app notification with your name, verified email, role, crew, and how you described your job.",
    stages: [
      { key: "profile", title: "Request sent", detail: "Saved the moment you submitted — you don't need to send it again.", phase: "done" },
      { key: "review", title: "An owner or admin reviews it", detail: "They confirm you actually belong on the team. Only they can approve.", phase: "current" },
      { key: "email", title: "Approval ends this session", detail: "You'll get an email with a fresh sign-in link into the team.", phase: "upcoming" },
    ],
    meanwhile: MEANWHILE_BASE,
    primaryAction: { kind: "check", label: "Check approval status" },
  };
}
