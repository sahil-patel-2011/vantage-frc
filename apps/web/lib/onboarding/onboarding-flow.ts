/** Soft-UI helpers for first-login `/onboarding` — closed membership, no DEMO access. */

/**
 * Step ids are the server's contract (`PATCH /api/onboarding` draft steps and the
 * resumable `currentStep` column), so they stay `profile | team | preferences`
 * even though the screens were rebuilt as You → Your team → Finish.
 */
export const ONBOARDING_SETUP_STEPS = ["profile", "team", "preferences"] as const;
export type OnboardingSetupStep = (typeof ONBOARDING_SETUP_STEPS)[number];
/** `pending` = submitted, waiting on a team. `done` = submitted and already in. */
export type OnboardingFlowStep = OnboardingSetupStep | "pending" | "done";

export type OnboardingStepPhase = "done" | "current" | "upcoming";

export type OnboardingStepMeta = {
  id: OnboardingSetupStep;
  index: number;
  label: string;
  shortLabel: string;
  description: string;
  phase: OnboardingStepPhase;
};

export const ONBOARDING_STEP_COPY: Record<
  OnboardingSetupStep,
  { label: string; shortLabel: string; description: string }
> = {
  profile: {
    label: "You",
    shortLabel: "You",
    description: "Your name and what you do on the team. Nothing here is shared until a team approves you.",
  },
  team: {
    label: "Your team",
    shortLabel: "Team",
    description: "Team number is optional. Entering one requests that team's approval — it never joins you.",
  },
  preferences: {
    label: "Finish",
    shortLabel: "Finish",
    description: "Agree to both documents, then submit. You can change everything later in Account.",
  },
};

export type OnboardingLoadKind = "loading" | "error" | "setup_required";

export type OnboardingLoadCopy = {
  kind: OnboardingLoadKind;
  eyebrow: string;
  title: string;
  description: string;
  badge?: string;
};

/** Progress index for the 3 setup steps; pending/done read as complete. */
export function onboardingStepIndex(step: OnboardingFlowStep): number {
  if (step === "pending" || step === "done") return ONBOARDING_SETUP_STEPS.length;
  return Math.max(0, ONBOARDING_SETUP_STEPS.indexOf(step));
}

export function onboardingStepPhase(
  stepId: OnboardingSetupStep,
  current: OnboardingFlowStep,
): OnboardingStepPhase {
  if (current === "pending" || current === "done") return "done";
  const currentIndex = onboardingStepIndex(current);
  const stepIndex = ONBOARDING_SETUP_STEPS.indexOf(stepId);
  if (stepIndex < currentIndex) return "done";
  if (stepIndex === currentIndex) return "current";
  return "upcoming";
}

/** Soft-UI stepper metadata for the 3 setup steps. */
export function buildOnboardingStepMeta(current: OnboardingFlowStep): OnboardingStepMeta[] {
  return ONBOARDING_SETUP_STEPS.map((id, index) => ({
    id,
    index,
    ...ONBOARDING_STEP_COPY[id],
    phase: onboardingStepPhase(id, current),
  }));
}

/** One-line progress for screen readers and Soft-UI clarity. */
export function onboardingProgressLabel(current: OnboardingFlowStep): string {
  if (current === "done") {
    return "All three steps done — your workspace is open";
  }
  if (current === "pending") {
    return "Profile submitted — waiting for team approval";
  }
  const index = onboardingStepIndex(current);
  const total = ONBOARDING_SETUP_STEPS.length;
  const label = ONBOARDING_STEP_COPY[ONBOARDING_SETUP_STEPS[index]!]?.label ?? "Setup";
  return `Step ${index + 1} of ${total} · ${label}`;
}

/**
 * Terms and Privacy are two separate consents. Both checkboxes are shown unless
 * this profile has already accepted BOTH documents. Migration 0460 backfills no
 * privacy_accepted_at, so a profile carrying only the old combined 0163 terms
 * timestamp is still asked — the old checkbox is not evidence of privacy consent.
 */
export function onboardingLegalRequired(input: {
  termsAcceptedAt?: string | null;
  privacyAcceptedAt?: string | null;
}): boolean {
  return !input.termsAcceptedAt?.trim() || !input.privacyAcceptedAt?.trim();
}


/**
 * Submit is blocked until BOTH boxes are ticked. The API re-validates; a client
 * checkbox is not consent.
 */
export function onboardingCanSubmit(input: {
  termsAccepted: boolean;
  privacyAccepted: boolean;
  termsAcceptedAt?: string | null;
  privacyAcceptedAt?: string | null;
}): boolean {
  if (!onboardingLegalRequired(input)) return true;
  return input.termsAccepted === true && input.privacyAccepted === true;
}

export type TeamAffiliationOption = "private_school" | "public_school" | "community";

/** Team heads must pick affiliation + at least one funding path before complete. */
export function onboardingFundingReady(input: {
  isTeamHead: boolean;
  teamAffiliation: TeamAffiliationOption | null | undefined;
  schoolFunded: boolean;
  outsideGrants: boolean;
  sponsorsAllowed: boolean;
}): boolean {
  if (!input.isTeamHead) return true;
  if (!input.teamAffiliation) return false;
  return Boolean(input.schoolFunded || input.outsideGrants || input.sponsorsAllowed);
}

/** Soft-UI copy for loading / error / setup shells — preserves invite + closed membership model. */
export function onboardingLoadCopy(kind: OnboardingLoadKind, detail?: string | null): OnboardingLoadCopy {
  if (kind === "loading") {
    return {
      kind,
      eyebrow: "SECURE ONBOARDING",
      title: "Loading your secure session…",
      description: "Restoring saved progress. Team access stays closed until an owner or invitation approves you.",
    };
  }
  if (kind === "setup_required") {
    return {
      kind,
      eyebrow: "SETUP REQUIRED",
      title: "Onboarding needs a signed-in session",
      description:
        detail?.trim() ||
        "Sign in again to continue. A team number never grants membership — you need an invite or owner approval.",
      badge: "Setup required",
    };
  }
  return {
    kind: "error",
    eyebrow: "COULD NOT LOAD",
    title: "Could not load onboarding",
    description:
      detail?.trim() ||
      "A network or server issue prevented loading.",
    badge: "Retry",
  };
}

/** Closed-membership callouts tied to access status (never invents approval). */
export function onboardingMembershipNote(
  accessStatus: "approved" | "invited" | "pending" | "declined" | "withdrawn" | "none" | null | undefined,
  options?: { preferredTeamNumber?: number | null },
): { title: string; body: string } {
  if (accessStatus === "invited") {
    return {
      title: "Invitation path",
      body: "Your team already sent an invite. Finish with the invitation link — team numbers still never auto-join you.",
    };
  }
  if (accessStatus === "pending") {
    return {
      title: "Awaiting that team's approval",
      body: "That workspace already exists. Only that team's owners or admins can let you in — a team number never joins you by itself.",
    };
  }
  if (accessStatus === "declined") {
    return {
      title: "Request not approved",
      body: "Update the team number if needed and submit again. Closed membership is intentional.",
    };
  }
  if (!options?.preferredTeamNumber) {
    return {
      title: "No team number yet",
      body: "You can finish without a team number. If you later enter a number for a team that already has Vantage, that team must specifically approve you. You cannot join someone else's workspace automatically.",
    };
  }
  return {
    title: "Closed membership",
    body: "Entering a team number only requests that team's approval. If the workspace already exists, their owners decide — members still also join by exact-email invite. Team heads can claim an unused TBA number at /claim.",
  };
}
