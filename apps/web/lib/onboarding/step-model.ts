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
  /** "" until the person picks a card: nobody is pre-filed as a Student. */
  teamRole: OnboardingRole | "";
  crewRole: OnboardingCrew | "";
  roleDescription: string;
  teamNumber: string;
  noTeam: boolean;
  primaryFocus: OnboardingFocus;
  displayName: string;
  /** "system" follows the device, like Account › Appearance. Only light and dark go to the server. */
  themePreference: "light" | "dark" | "system";
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
    teamRole: "",
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
  teamRole: OnboardingRole | "" | null | undefined,
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

/** Same floor the server enforces (`packages/core/src/eligibility.ts`). */
export const MINIMUM_ACCOUNT_AGE = 13;
const OLDEST_AGE = 120;

/**
 * Whole years from a YYYY-MM-DD birthday to `now`, by calendar date in UTC like the server, or
 * null when the text is not a real date.
 */
export function ageOnDate(dateOfBirth: string, now: Date = new Date()): number | null {
  const text = dateOfBirth.trim();
  if (!ISO_DATE.test(text)) return null;
  const [year, month, day] = text.split("-").map(Number) as [number, number, number];
  // setUTCFullYear, not Date.UTC: Date.UTC reads years 0 to 99 as 1900 to 1999.
  const dob = new Date(0);
  dob.setUTCFullYear(year, month - 1, day);
  if (dob.getUTCFullYear() !== year || dob.getUTCMonth() !== month - 1 || dob.getUTCDate() !== day) return null;
  let age = now.getUTCFullYear() - year;
  if (now.getUTCMonth() < month - 1 || (now.getUTCMonth() === month - 1 && now.getUTCDate() < day)) age--;
  return age;
}

/**
 * What is wrong with a birthday, in the words the person needs, or null when the server will take
 * it. These used to be checked only by the server, whose answer appeared at the top of the card
 * while the person's thumb was on Continue at the bottom: on a phone, Continue looked dead.
 */
export function birthDateProblem(dateOfBirth: string, now: Date = new Date()): string | null {
  if (!ISO_DATE.test(dateOfBirth.trim())) {
    return "Add your date of birth. It keeps student accounts safe, and teammates never see it.";
  }
  const age = ageOnDate(dateOfBirth, now);
  if (age === null) return "That date doesn't exist. Check the day and the month.";
  // Any date after today counts to -1 or less; today itself is 0, which the age rule covers.
  if (age < 0) {
    return "Your date of birth can't be in the future. Check the year.";
  }
  if (age > OLDEST_AGE) return "Check the year of your date of birth.";
  if (age < MINIMUM_ACCOUNT_AGE) {
    return "Vantage accounts are for people age 13 and older. If the year is a typo, fix it here.";
  }
  return null;
}

/**
 * A role and a birthday that rarely go together: an adult role under 18, or Student at 25 or
 * older. The birthday decides student protections and the role is only a label, so a slip in
 * either one is worth a question before it is saved. Null when they fit.
 */
export function roleAgeQuestion(
  teamRole: OnboardingRole | "",
  dateOfBirth: string,
  now: Date = new Date(),
): string | null {
  const age = ageOnDate(dateOfBirth, now);
  if (age === null || !teamRole) return null;
  const label = { student: "Student", mentor: "Mentor", coach: "Head mentor or coach", parent: "Parent", other: "Other" }[teamRole];
  if (age < 18 && (teamRole === "mentor" || teamRole === "coach" || teamRole === "parent")) {
    return `You picked ${label}, and your date of birth makes you ${age}. Is that right?`;
  }
  if (age >= 25 && teamRole === "student") {
    return `You picked Student, and your date of birth makes you ${age}. Is that right?`;
  }
  return null;
}

function validateProfileStep(draft: OnboardingDraft, now: Date = new Date()): StepValidation {
  if (!draft.firstName.trim()) {
    return { ok: false, field: "firstName", message: "Add your first name." };
  }
  if (!draft.lastName.trim()) {
    return { ok: false, field: "lastName", message: "Add your last name." };
  }
  if (!draft.teamRole) {
    return { ok: false, field: "teamRole", message: "Pick the card that matches your role." };
  }
  // Required by the account system, not by us: `POST /api/onboarding` rejects the submit without
  // it, and checks the same rules as here.
  const birthday = birthDateProblem(draft.dateOfBirth, now);
  if (birthday) return { ok: false, field: "dateOfBirth", message: birthday };
  return { ok: true };
}

/**
 * Where a message from the server belongs: the screen and the field that can fix it, so it is
 * shown beside that field instead of at the top of a card. Null for anything no field can fix (a
 * lost connection, a server fault); those sit above the step's buttons.
 */
export function onboardingErrorTarget(message: string): { step: OnboardingSetupStep; field: string } | null {
  if (/birth|age 13/i.test(message)) return { step: "profile", field: "dateOfBirth" };
  if (/first name/i.test(message)) return { step: "profile", field: "firstName" };
  if (/last name/i.test(message)) return { step: "profile", field: "lastName" };
  if (/gender/i.test(message)) return { step: "profile", field: "gender" };
  if (/team role/i.test(message)) return { step: "profile", field: "teamRole" };
  if (/affiliated|private school, public school/i.test(message)) return { step: "team", field: "teamAffiliation" };
  if (/funding path|how the team is funded|funded/i.test(message)) return { step: "team", field: "funding" };
  if (/team number/i.test(message)) return { step: "team", field: "teamNumber" };
  if (/terms of service|privacy policy/i.test(message)) return { step: "preferences", field: "legal" };
  return null;
}

/**
 * The screen to reopen on. The server moves its saved step to "team" after the profile is saved,
 * but someone the invite already put on a team never sees that screen (skipsTeamStep). A reload
 * used to show them the team screen anyway, a flow they had not seen before Continue.
 */
export function resumeOnboardingStep(
  serverStep: string | null | undefined,
  context: Pick<OnboardingStepContext, "locked" | "isTeamHead">,
): OnboardingSetupStep {
  if (serverStep === "preferences") return "preferences";
  if (serverStep === "team") return skipsTeamStep(context) ? "preferences" : "team";
  return "profile";
}

/**
 * The focus to show after a reload. The server answers "competition" when nothing was picked
 * (the column has a default), so only a saved team screen (or a finished profile) counts as an
 * answer. Otherwise the role's default applies, the same one picking the role sets: a parent who
 * skipped the team screen was shown "Starting view: Competition".
 */
export function resumedFocus(input: {
  serverFocus: OnboardingFocus | null | undefined;
  serverStep: string | null | undefined;
  teamRole: OnboardingRole | "" | null | undefined;
  crewRole: OnboardingCrew | "" | null | undefined;
}): { focus: OnboardingFocus; answered: boolean } {
  const answered = input.serverStep === "preferences" || input.serverStep === "complete";
  if (answered && input.serverFocus) return { focus: input.serverFocus, answered: true };
  return { focus: defaultFocusForRole(input.teamRole, input.crewRole), answered: false };
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
  // Team location is optional: it can be added later on Team profile.
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
  now: Date = new Date(),
): StepValidation {
  switch (step) {
    case "profile":
      return validateProfileStep(draft, now);
    case "team":
      return validateTeamStep(draft, context);
    case "preferences":
      return validateFinishStep(draft, context);
  }
}

/**
 * Every screen up to and including `upTo`, in order: the first answer still missing. Finish used
 * to check only its own screen, so someone who reopened on it (or whose team was set up while
 * they were away, which adds the funding questions) pressed it, was refused by the server and
 * landed back on the team screen with no word about why.
 */
export function firstMissingAnswer(
  upTo: OnboardingSetupStep,
  draft: OnboardingDraft,
  context: OnboardingStepContext,
  now: Date = new Date(),
): { step: OnboardingSetupStep; field: string; message: string } | null {
  const last = ONBOARDING_SETUP_STEPS.indexOf(upTo);
  for (const step of ONBOARDING_SETUP_STEPS.slice(0, last + 1)) {
    if (step === "team" && skipsTeamStep(context)) continue;
    const result = validateOnboardingStep(step, draft, context, now);
    if (!result.ok) return { step, field: result.field, message: result.message };
  }
  return null;
}

/** Each earlier screen that still needs an answer, with what it needs. Listed on Finish. */
export function missingAnswersBefore(
  step: OnboardingSetupStep,
  draft: OnboardingDraft,
  context: OnboardingStepContext,
  now: Date = new Date(),
): Array<{ step: OnboardingSetupStep; field: string; message: string }> {
  const gaps: Array<{ step: OnboardingSetupStep; field: string; message: string }> = [];
  for (const earlier of ONBOARDING_SETUP_STEPS.slice(0, ONBOARDING_SETUP_STEPS.indexOf(step))) {
    if (earlier === "team" && skipsTeamStep(context)) continue;
    const result = validateOnboardingStep(earlier, draft, context, now);
    if (!result.ok) gaps.push({ step: earlier, field: result.field, message: result.message });
  }
  return gaps;
}

/** Whether a screen's required answers are all there (for the progress marks). */
export function onboardingStepComplete(
  step: OnboardingSetupStep,
  draft: OnboardingDraft,
  context: OnboardingStepContext,
  now: Date = new Date(),
): boolean {
  if (step === "team" && skipsTeamStep(context)) return true;
  return validateOnboardingStep(step, draft, context, now).ok;
}

/**
 * Someone who joined through an invite and is not the team's head has nothing to answer on the
 * team screen: the number is locked to their team and the rest is for whoever runs it. They go
 * You, then Finish; their focus keeps the default their role gave it (changeable in Account).
 */
export function skipsTeamStep(context?: Pick<OnboardingStepContext, "locked" | "isTeamHead"> | null): boolean {
  return Boolean(context?.locked && !context.isTeamHead);
}

export function nextOnboardingStep(
  step: OnboardingSetupStep,
  context?: Pick<OnboardingStepContext, "locked" | "isTeamHead"> | null,
): OnboardingSetupStep | null {
  const index = ONBOARDING_SETUP_STEPS.indexOf(step);
  const next = ONBOARDING_SETUP_STEPS[index + 1] ?? null;
  if (next === "team" && skipsTeamStep(context)) return ONBOARDING_SETUP_STEPS[index + 2] ?? null;
  return next;
}

export function previousOnboardingStep(
  step: OnboardingFlowStep,
  context?: Pick<OnboardingStepContext, "locked" | "isTeamHead"> | null,
): OnboardingSetupStep | null {
  // From the pending panel, "change my answers" returns to the team screen.
  if (step === "pending") return "team";
  if (step === "done") return null;
  const index = ONBOARDING_SETUP_STEPS.indexOf(step);
  if (index <= 0) return null;
  const previous = ONBOARDING_SETUP_STEPS[index - 1] ?? null;
  if (previous === "team" && skipsTeamStep(context)) return ONBOARDING_SETUP_STEPS[index - 2] ?? null;
  return previous;
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
  now: Date = new Date(),
): OnboardingStepState & { submit: boolean } {
  if (state.step === "pending" || state.step === "done") {
    return { ...state, submit: false };
  }
  // This screen and every one before it: a gap on an earlier screen sends the person back to it,
  // with the message beside the field, instead of a refusal from the server.
  const missing = firstMissingAnswer(state.step, state.draft, context, now);
  if (missing) {
    return {
      step: missing.step,
      draft: state.draft,
      error: missing.message,
      errorField: missing.field,
      submit: false,
    };
  }
  const next = nextOnboardingStep(state.step, context);
  if (!next) {
    return { step: state.step, draft: state.draft, error: null, errorField: null, submit: true };
  }
  return { step: next, draft: state.draft, error: null, errorField: null, submit: false };
}

/** Back never validates and never rewrites the draft. */
export function onboardingGoBack(
  state: OnboardingStepState,
  context?: Pick<OnboardingStepContext, "locked" | "isTeamHead"> | null,
): OnboardingStepState {
  const previous = previousOnboardingStep(state.step, context);
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
  kind:
    | "pending"
    | "invited"
    | "declined"
    | "no_workspace"
    | "no_team"
    | "platform_admin"
    | "team_requested"
    | "team_request_declined"
    | "banned";
  eyebrow: string;
  headline: string;
  /** Who actually received a notification — empty string when nobody did. */
  notified: string;
  stages: PendingStage[];
  meanwhile: PendingMeanwhileLink[];
  primaryAction: { kind: "check" | "edit" | "invite" | "claim" | "join" | "admin"; label: string };
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

/** The latest request to put a team on Vantage, as GET /api/onboarding reports it. */
export type PendingTeamRequest = {
  teamNumber: number;
  status: "pending" | "approved" | "declined" | "withdrawn" | "forwarded";
  declineReason: string | null;
};

export function buildOnboardingPendingPlan(input: {
  accessStatus: TeamLookupAccessStatus | null | undefined;
  teamNumber: number | null;
  orgName: string | null;
  adult: boolean;
  workspaceMissing?: boolean;
  /** A platform admin on no team: their way on is the admin console, not "join a team". */
  platformAdmin?: boolean;
  teamRequest?: PendingTeamRequest | null;
  /** Teams this person is on that a ban suspended. */
  bannedTeams?: Array<{ teamNumber: number; orgName: string }>;
}): OnboardingPendingPlan {
  const teamLabel = input.orgName ?? (input.teamNumber ? `FRC Team ${input.teamNumber}` : "your team");

  // A suspended team comes first: an empty Home would be the only other clue.
  const banned = input.bannedTeams?.[0];
  if (banned && input.accessStatus !== "invited" && input.accessStatus !== "pending") {
    return {
      kind: "banned",
      eyebrow: "TEAM SUSPENDED",
      headline: `Team ${banned.teamNumber} is suspended from Vantage`,
      notified: "",
      stages: [
        {
          key: "why",
          title: "Why",
          detail: "Vantage suspended this team for breaking its Terms of Service or Privacy Policy.",
          phase: "done",
        },
        {
          key: "data",
          title: "Nothing was deleted",
          detail: "Your account is unaffected, and the team's work is kept while the suspension is reviewed.",
          phase: "current",
        },
        {
          key: "next",
          title: "Questions?",
          detail: "Reply to any Vantage email, or join another team with an invite or a team code.",
          phase: "upcoming",
        },
      ],
      meanwhile: MEANWHILE_BASE,
      primaryAction: { kind: "edit", label: "Use a different team" },
    };
  }

  if (input.platformAdmin && input.accessStatus !== "invited" && input.accessStatus !== "pending") {
    return {
      kind: "platform_admin",
      eyebrow: "PLATFORM ADMIN",
      headline: "You're set up. Teams start in the admin console.",
      notified: "",
      stages: [
        { key: "profile", title: "Profile saved", detail: "Your name and role are stored privately.", phase: "done" },
        {
          key: "admin",
          title: "Add a team and its owner",
          detail: "The admin console creates teams, invites their owners and works the waitlist.",
          phase: "current",
        },
        {
          key: "team",
          title: "Join a team if you're on one",
          detail: "An invite or a team code makes you a member, separately from admin access.",
          phase: "upcoming",
        },
      ],
      meanwhile: MEANWHILE_BASE,
      primaryAction: { kind: "admin", label: "Open the admin console" },
    };
  }

  const request = input.teamRequest;
  if (request?.status === "pending" && input.accessStatus !== "invited") {
    return {
      kind: "team_requested",
      eyebrow: "TEAM REQUEST SENT",
      headline: `Vantage is reviewing Team ${request.teamNumber}`,
      notified: "The Vantage team got your request with your name, verified email and role.",
      stages: [
        { key: "profile", title: "Request sent", detail: "Saved the moment you finished. You don't need to send it again.", phase: "done" },
        {
          key: "review",
          title: "Vantage checks it",
          detail: `Team ${request.teamNumber} isn't on Vantage yet, or nobody leads it yet, so the Vantage team reviews who should run it.`,
          phase: "current",
        },
        {
          key: "owner",
          title: "You run the team",
          detail: "Once approved you're its owner: invite teammates and choose what each person can see.",
          phase: "upcoming",
        },
      ],
      meanwhile: MEANWHILE_BASE,
      primaryAction: { kind: "check", label: "Check status" },
    };
  }
  if (request?.status === "declined" && (input.accessStatus === "none" || input.accessStatus == null)) {
    return {
      kind: "team_request_declined",
      eyebrow: "REQUEST NOT APPROVED",
      headline: `Vantage didn't approve the request for Team ${request.teamNumber}`,
      notified: "",
      stages: [
        {
          key: "why",
          title: "What Vantage said",
          detail: request.declineReason?.trim() || "No reason was given. The usual cause is a team number that belongs to someone else.",
          phase: "done",
        },
        { key: "fix", title: "Check the number", detail: "Make sure it's the number on your robot's bumpers.", phase: "current" },
        { key: "again", title: "Ask again, or ask your mentor", detail: "A team's head mentor is usually who sets it up.", phase: "upcoming" },
      ],
      meanwhile: MEANWHILE_BASE,
      primaryAction: { kind: "edit", label: "Change my team" },
    };
  }

  if (input.accessStatus === "invited") {
    return {
      kind: "invited",
      eyebrow: "INVITATION READY",
      headline: `${teamLabel} invited you`,
      notified: "",
      stages: [
        { key: "profile", title: "Profile saved", detail: "Your name, role, and crew are stored privately.", phase: "done" },
        { key: "invite", title: "Join the team", detail: "The invite was sent to the email you signed in with, so one tap joins.", phase: "current" },
        { key: "in", title: "You're in", detail: "Home opens on your team.", phase: "upcoming" },
      ],
      meanwhile: MEANWHILE_BASE,
      primaryAction: { kind: "join", label: `Join ${teamLabel}` },
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
  if (input.accessStatus === "none" && input.teamNumber && input.workspaceMissing) {
    return {
      kind: "no_workspace",
      eyebrow: "TEAM NOT SET UP YET",
      headline: `Nobody has set up Team ${input.teamNumber} on Vantage`,
      notified: "",
      stages: [
        { key: "profile", title: "Profile saved", detail: "You're signed up — you just aren't attached to a team.", phase: "done" },
        {
          key: "claim",
          title: "Create your team workspace",
          detail: "If your team authorized you, you can set it up and manage it until you hand it over to your lead.",
          phase: "current",
        },
        { key: "join", title: "Invite your teammates", detail: "Choose their access. Your team lead can take over once they join.", phase: "upcoming" },
      ],
      meanwhile: MEANWHILE_BASE,
      primaryAction: { kind: "claim", label: "Create this team" },
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
        { key: "approve", title: "That team decides", detail: "Knowing a team number never opens someone else's team.", phase: "upcoming" },
      ],
      meanwhile: MEANWHILE_BASE,
      primaryAction: { kind: "edit", label: "Add a team number" },
    };
  }

  if (input.accessStatus === "none" || input.accessStatus === "withdrawn") {
    return {
      kind: "no_team",
      eyebrow: "PROFILE SAVED",
      headline: "Your profile is ready. Join your team next.",
      notified: "",
      stages: [
        { key: "profile", title: "Profile saved", detail: "Your team preference does not grant access." , phase: "done" },
        { key: "team", title: "Join by invitation or request access", detail: "Open the invitation sent to your verified email, or review your team number and submit a request.", phase: "current" },
        { key: "approve", title: "That team decides", detail: "Knowing a team number never opens someone else's team.", phase: "upcoming" },
      ],
      meanwhile: MEANWHILE_BASE,
      primaryAction: { kind: "edit", label: "Review my team request" },
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
