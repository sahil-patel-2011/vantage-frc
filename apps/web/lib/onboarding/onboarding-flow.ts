/** Soft-UI helpers for first-login `/onboarding` — closed membership, no DEMO access. */

export const ONBOARDING_SETUP_STEPS = ["profile", "team", "preferences"] as const;
export type OnboardingSetupStep = (typeof ONBOARDING_SETUP_STEPS)[number];
export type OnboardingFlowStep = OnboardingSetupStep | "pending";

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
    description: "Name and youth-safe profile details stay private until review.",
  },
  team: {
    label: "Team & focus",
    shortLabel: "Team",
    description: "Team number routes your request — it never unlocks a workspace by itself.",
  },
  preferences: {
    label: "Review",
    shortLabel: "Review",
    description: "Confirm focus, accept terms if needed, then request closed membership.",
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

/** Progress index for the 3 setup steps; pending reads as complete. */
export function onboardingStepIndex(step: OnboardingFlowStep): number {
  if (step === "pending") return ONBOARDING_SETUP_STEPS.length;
  return Math.max(0, ONBOARDING_SETUP_STEPS.indexOf(step));
}

export function onboardingStepPhase(
  stepId: OnboardingSetupStep,
  current: OnboardingFlowStep,
): OnboardingStepPhase {
  if (current === "pending") return "done";
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
  if (current === "pending") {
    return "Profile submitted — waiting for team approval";
  }
  const index = onboardingStepIndex(current);
  const total = ONBOARDING_SETUP_STEPS.length;
  const label = ONBOARDING_STEP_COPY[ONBOARDING_SETUP_STEPS[index]!]?.label ?? "Setup";
  return `Step ${index + 1} of ${total} · ${label}`;
}

/**
 * Terms checkbox is required on submit unless this profile already accepted.
 * API still expects `termsAccepted: true` on complete — UI may skip re-check when prior acceptance exists.
 */
export function onboardingTermsRequired(termsAcceptedAt: string | null | undefined): boolean {
  return !termsAcceptedAt?.trim();
}

export function onboardingCanSubmit(input: {
  termsAccepted: boolean;
  termsAcceptedAt?: string | null;
}): boolean {
  if (!onboardingTermsRequired(input.termsAcceptedAt)) return true;
  return input.termsAccepted === true;
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
      "A network or server issue prevented loading. Nothing was filled with DEMO access — retry when ready.",
    badge: "Retry",
  };
}

/** Closed-membership callouts tied to access status (never invents approval). */
export function onboardingMembershipNote(
  accessStatus: "approved" | "invited" | "pending" | "declined" | "withdrawn" | "none" | null | undefined,
): { title: string; body: string } {
  if (accessStatus === "invited") {
    return {
      title: "Invitation path",
      body: "Your team already sent an invite. Finish with the invitation link — team numbers still never auto-join you.",
    };
  }
  if (accessStatus === "pending") {
    return {
      title: "Awaiting approval",
      body: "An owner or administrator must approve this verified account before any team data opens.",
    };
  }
  if (accessStatus === "declined") {
    return {
      title: "Request not approved",
      body: "Update the team number if needed and submit again. Closed membership is intentional.",
    };
  }
  return {
    title: "Closed membership",
    body: "Submitting a team number routes a request only. Access requires invite acceptance or owner/admin approval.",
  };
}
