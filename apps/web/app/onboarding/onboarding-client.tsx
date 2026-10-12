"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { isAccessRole, roleHint, roleLabel } from "@vantage/core/role-words";
import { VantageLogo } from "../../components/brand";
import {
  buildOnboardingStepMeta,
  buildOnboardingPendingPlan,
  defaultFocusForRole,
  emptyOnboardingDraft,
  isAdultRole,
  lookupTeamNumber,
  onboardingAdvance,
  onboardingCanSubmit,
  onboardingGoBack,
  onboardingLegalRequired,
  onboardingLoadCopy,
  onboardingErrorTarget,
  onboardingMembershipNote,
  onboardingProgressLabel,
  resumeOnboardingStep,
  resumedFocus,
  roleAgeQuestion,
  skipsTeamStep,
  submittedTeamNumber,
  type OnboardingCrew,
  type OnboardingDraft,
  type OnboardingFlowStep,
  type OnboardingRole,
  type OnboardingStepContext,
} from "../../lib/onboarding";
import { askConfirm } from "../../components/ui/confirm-dialog";
import { applyThemeChoice, deviceThemePreference } from "../theme-provider";
import {
  fundingModelFromFlags,
  isFundingModel,
} from "../../lib/funding-profile";
import { legalConsentMessage } from "../../lib/legal";
import { confirmedOnboardingState, onboardingAnswersKey, onboardingReturnPath } from "../../lib/onboarding/entry-journey";
import { signOutAndRedirect } from "../../lib/sign-out";
import { OnboardingLoadShell } from "./onboarding-chrome";
import { LandingPanel } from "./onboarding-landing";
import {
  isCrew,
  isGender,
  isRole,
  pendingInviteDestination,
  type OnboardingState,
} from "./onboarding-model";
import { PendingPanel } from "./onboarding-pending";
import { ONBOARDING_ERROR_ID, PreferencesForm, ProfileForm, TeamForm } from "./onboarding-steps";
import "./onboarding-flow.css";
import "../vantage-scan-auth.css";

/** Each setup step's own heading when nothing special (an invite, a new team) frames the flow. */
const GENERIC_STEP_HEADERS: Record<"profile" | "team" | "preferences", { title: string; sub: string }> = {
  profile: {
    title: "Tell us about you",
    sub: "Teammates see your name once you're on a team. Nothing else here is shared.",
  },
  team: {
    title: "Find your team",
    sub: "Enter your FRC team number. The team decides who gets in.",
  },
  preferences: {
    title: "Check and finish",
    sub: "Make sure this looks right. You can change any of it later in Account.",
  },
};

export default function OnboardingClient() {
  const searchParams = useSearchParams();
  const [state, setState] = useState<OnboardingState | null>(null);
  const [step, setStep] = useState<OnboardingFlowStep>("profile");
  // Continue kept the scroll position, so step 2 opened at the bottom of its last block and the
  // person never saw that a new step started. Every step change starts at the heading.
  const firstStep = useRef(true);
  /** Set while an error is waiting to be brought into view; it wins over the jump to the top. */
  const errorScroll = useRef<{ field: string | null } | null>(null);
  useEffect(() => {
    if (firstStep.current) {
      firstStep.current = false;
      return;
    }
    if (errorScroll.current) return;
    window.scrollTo({ top: 0 });
    document.getElementById("onboarding-title")?.focus({ preventScroll: true });
  }, [step]);
  const [draft, setDraft] = useState<OnboardingDraft>(() => emptyOnboardingDraft());
  /** True once the person picked a focus themselves — stops the role default overriding them. */
  const focusTouched = useRef(false);
  /** True once the person picked an appearance here; only then is it saved as their choice. */
  const themeTouched = useRef(false);
  const [message, setMessage] = useState("");
  const [errorField, setErrorField] = useState<string | null>(null);

  /**
   * Show a message beside what it is about and bring it into view. Every failure goes through
   * here: the gate's own checks, the server's answer and a lost connection. Only the first used
   * to scroll, so on a phone a refused birthday or a dropped connection looked like a dead button.
   */
  const [errorTick, setErrorTick] = useState(0);
  const showError = useCallback((text: string, field: string | null) => {
    errorScroll.current = { field };
    setMessage(text);
    setErrorField(field);
    setErrorTick((tick) => tick + 1);
  }, []);
  // After the render that shows it (and after the step effect above, which leaves the scroll to
  // this one when an error sent the person back to an earlier screen).
  useEffect(() => {
    const pending = errorScroll.current;
    if (!pending) return;
    errorScroll.current = null;
    const target =
      (pending.field ? document.querySelector<HTMLElement>(".onboarding-form [aria-invalid='true']") : null) ??
      document.getElementById(ONBOARDING_ERROR_ID);
    const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    target?.scrollIntoView({ behavior: still ? "auto" : "smooth", block: "center" });
    if (target && target.matches("input, select, textarea")) target.focus({ preventScroll: true });
  }, [errorTick]);

  /** A refusal from the server, shown on the screen and beside the field that can fix it. */
  function showServerError(text: string) {
    const target = onboardingErrorTarget(text);
    if (target && target.step !== step) setStep(target.step);
    showError(text, target?.field ?? null);
  }
  const [busy, setBusy] = useState(false);
  const mutationRef = useRef(false);
  const loadRef = useRef<AbortController | null>(null);
  const answersScope = useRef<{ userId: string | null; orgId: string | null }>({ userId: null, orgId: null });
  const [legalError, setLegalError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadStatus, setLoadStatus] = useState<"loading" | "ready" | "error" | "setup_required">("loading");

  const patch = useCallback((next: Partial<OnboardingDraft>) => {
    setDraft((current) => {
      const merged = { ...current, ...next };
      saveLocalAnswers(merged, answersScope.current);
      return merged;
    });
  }, []);

  // Answers saved in an earlier visit, noted once on arrival. "Progress restored" used to show
  // after every Continue in the same visit, when nothing had been lost.
  const [restoredFrom, setRestoredFrom] = useState<string | null | undefined>(undefined);

  const hydrate = useCallback((data: OnboardingState) => {
    setState(data);
    setRestoredFrom((current) => (current === undefined ? data.savedAt ?? null : current));
    // Answers the server only takes with a later step (crew with step two, affiliation with
    // Finish), kept on this device so "Welcome back" is true in a new tab (see answersStore).
    answersScope.current = { userId: data.userId ?? null, orgId: data.workspaceOrgId ?? null };
    const local = readLocalAnswers(answersScope.current);
    // The server answers "competition" when no focus was ever picked, so a saved team screen is
    // what makes it an answer (resumedFocus); otherwise the role's default stands.
    const resumed = (role: OnboardingRole | "", crew: OnboardingCrew | "") =>
      resumedFocus({ serverFocus: data.primaryFocus, serverStep: data.currentStep, teamRole: role, crewRole: crew });
    setDraft((current) => {
      // Someone the team made an owner or admin is not a student; start them on Mentor instead
      // of pre-picking Student for everyone.
      const teamRole: OnboardingRole | "" = isRole(data.teamRole)
        ? data.teamRole
        : typeof local.teamRole === "string" && isRole(local.teamRole)
          ? local.teamRole
          : data.isTeamHead || data.workspaceRole === "owner" || data.workspaceRole === "admin"
            ? "mentor"
            : current.teamRole;
      const crewRole: OnboardingCrew | "" = isCrew(data.crewRole)
        ? data.crewRole
        : typeof local.crewRole === "string" && isCrew(local.crewRole) ? local.crewRole : current.crewRole;
      const focus = resumed(teamRole, crewRole);
      if (focus.answered) focusTouched.current = true;
      return {
      ...current,
      // Names typed before a reload come back from this device until Continue saves them. The
      // birthday is not kept here: it stays on the server only.
      firstName: data.firstName ?? (typeof local.firstName === "string" && local.firstName ? local.firstName : current.firstName),
      lastName: data.lastName ?? (typeof local.lastName === "string" && local.lastName ? local.lastName : current.lastName),
      dateOfBirth: data.dateOfBirth ?? current.dateOfBirth,
      gender: isGender(data.gender) ? data.gender : current.gender,
      teamRole,
      crewRole,
      roleDescription: data.roleDescription ?? (typeof local.roleDescription === "string" ? local.roleDescription : current.roleDescription),
      teamNumber: String(data.lockedTeamNumber ?? data.preferredTeamNumber ?? current.teamNumber ?? ""),
      noTeam: data.complete && !data.lockedTeamNumber && data.preferredTeamNumber == null ? true : current.noTeam,
      primaryFocus: focusTouched.current && !focus.answered ? current.primaryFocus : focus.focus,
      displayName: data.displayName ?? current.displayName,
      // What this device shows now. The server's copy is only the column default until Finish.
      themePreference: themeTouched.current ? current.themePreference : deviceThemePreference(),
      orgCity: data.orgCity ?? (typeof local.orgCity === "string" ? local.orgCity : current.orgCity),
      orgStateProv: data.orgStateProv ?? (typeof local.orgStateProv === "string" ? local.orgStateProv : current.orgStateProv),
      orgDescription: data.orgDescription ?? current.orgDescription,
      teamAffiliation:
        data.orgTeamAffiliation ??
        (local.teamAffiliation === "private_school" ||
        local.teamAffiliation === "public_school" ||
        local.teamAffiliation === "community"
          ? local.teamAffiliation
          : current.teamAffiliation),
      fundingModel:
        data.orgFundingModel && isFundingModel(data.orgFundingModel)
          ? data.orgFundingModel
          : (typeof local.fundingModel === "string" && isFundingModel(local.fundingModel) ? local.fundingModel : "") ||
            current.fundingModel ||
            // Only from answers the team already gave; a new team starts unpicked, like Affiliation.
            (data.orgSchoolFunded != null || data.orgSponsorsAllowed != null
              ? fundingModelFromFlags({
                  schoolFunded: data.orgSchoolFunded ?? current.schoolFunded,
                  sponsorsAllowed: data.orgSponsorsAllowed ?? current.sponsorsAllowed,
                })
              : ""),
      schoolFunded: data.orgSchoolFunded ?? current.schoolFunded,
      outsideGrants: data.orgOutsideGrants ?? current.outsideGrants,
      sponsorsAllowed: data.orgSponsorsAllowed ?? current.sponsorsAllowed,
      termsAccepted: data.termsAcceptedAt ? true : current.termsAccepted,
      privacyAccepted: data.privacyAcceptedAt ? true : current.privacyAccepted,
      };
    });
  }, []);

  const approvedDestination = useCallback(
    (data: OnboardingState) => {
      const fallback = data.workspaceOrgId ? `/dashboard?orgId=${encodeURIComponent(data.workspaceOrgId)}` : data.platformAdmin ? "/admin" : "/workspace";
      return onboardingReturnPath(searchParams.get("next"), fallback);
    },
    [searchParams],
  );

  /** On load, an already-complete profile goes straight through — the landing
   *  screen is for the moment you finish, not every later visit. */
  const routeCompleteState = useCallback(
    (data: OnboardingState, justFinished: boolean) => {
      if (data.accessStatus === "approved") {
        if (justFinished) {
          setStep("done");
          return;
        }
        window.location.assign(approvedDestination(data));
        return;
      }
      if (data.accessStatus === "invited") {
        const inviteDestination = pendingInviteDestination();
        if (inviteDestination) {
          window.location.assign(inviteDestination);
          return;
        }
      }
      setStep("pending");
    },
    [approvedDestination],
  );

  const loadSession = useCallback(() => {
    loadRef.current?.abort();
    const controller = new AbortController();
    loadRef.current = controller;
    setLoadStatus("loading");
    setLoadError(null);
    void fetch("/api/onboarding", { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]) })
      .then(async (response) => {
        if (controller.signal.aborted) return null;
        if (response.status === 401) {
          setLoadStatus("setup_required");
          setLoadError("Sign in to finish setting up your profile.");
          setState(null);
          return null;
        }
        if (!response.ok) {
          const data = (await response.json().catch(() => ({}))) as { error?: string };
          setLoadStatus("error");
          setLoadError(data.error ?? "Could not load your onboarding steps.");
          setState(null);
          return null;
        }
        const data: unknown = await response.json();
        if (!confirmedOnboardingState(data)) throw new Error("Invalid onboarding confirmation");
        return data as OnboardingState;
      })
      .then((data) => {
        if (!data || controller.signal.aborted) return;
        hydrate(data);
        setLoadStatus("ready");
        if (data.complete) routeCompleteState(data, false);
        else setStep(resumeOnboardingStep(data.currentStep, stepContextOf(data)));
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setLoadStatus("error");
        setLoadError("Could not load onboarding. Check your connection and try again.");
        setState(null);
      });
  }, [hydrate, routeCompleteState]);

  useEffect(() => {
    loadSession();
    return () => loadRef.current?.abort();
  }, []);

  const locked = state?.lockedTeamNumber != null;
  const legalNeeded = onboardingLegalRequired({
    termsAcceptedAt: state?.termsAcceptedAt,
    privacyAcceptedAt: state?.privacyAcceptedAt,
  });

  const context: OnboardingStepContext = useMemo(
    () => ({
      isTeamHead: Boolean(state?.isTeamHead),
      legalNeeded,
      locked,
      lockedTeamNumber: state?.lockedTeamNumber ?? null,
      lockedOrgName: state?.lockedOrgName ?? null,
      accessStatus: state?.accessStatus ?? null,
      knownTeamNumber: state?.preferredTeamNumber ?? null,
    }),
    [state, legalNeeded, locked],
  );

  const adult = isAdultRole(draft.teamRole);
  const lookup = useMemo(
    () =>
      lookupTeamNumber({
        raw: draft.teamNumber,
        noTeam: draft.noTeam,
        locked,
        lockedTeamNumber: state?.lockedTeamNumber ?? null,
        lockedOrgName: state?.lockedOrgName ?? null,
        accessStatus: state?.accessStatus ?? null,
        knownTeamNumber: state?.preferredTeamNumber ?? null,
        workspaceMissing: state?.workspaceMissing,
        teamRequest: state?.teamRequest ?? null,
        adult,
        owner: state?.workspaceRole === "owner",
      }),
    [draft.teamNumber, draft.noTeam, locked, state, adult],
  );

  const canSubmit = onboardingCanSubmit({
    termsAccepted: draft.termsAccepted,
    privacyAccepted: draft.privacyAccepted,
    termsAcceptedAt: state?.termsAcceptedAt,
    privacyAcceptedAt: state?.privacyAcceptedAt,
  });
  const skipTeam = skipsTeamStep(context);
  const stepMeta = useMemo(() => buildOnboardingStepMeta(step, { skipTeam }), [step, skipTeam]);
  const progressLabel = onboardingProgressLabel(step, { skipTeam });
  const membershipNote = onboardingMembershipNote(state?.accessStatus ?? "none", {
    preferredTeamNumber: state?.preferredTeamNumber ?? lookup.teamNumber,
  });

  function pickRole(value: OnboardingRole) {
    const nextFocus = focusTouched.current ? draft.primaryFocus : defaultFocusForRole(value, draft.crewRole);
    patch({ teamRole: value, primaryFocus: nextFocus });
    setErrorField(null);
  }

  /** "" is "Not sure yet". */
  function pickCrew(value: OnboardingCrew | "") {
    const nextFocus = focusTouched.current ? draft.primaryFocus : defaultFocusForRole(draft.teamRole, value);
    patch({ crewRole: value, primaryFocus: nextFocus });
  }

  function pickTheme(value: OnboardingDraft["themePreference"]) {
    themeTouched.current = true;
    patch({ themePreference: value });
    // Shown now, the way Account does it; Finish saves light or dark to the account.
    applyThemeChoice(value);
  }

  function goBack() {
    const back = onboardingGoBack({ step, draft, error: null, errorField: null }, context);
    setStep(back.step);
    setMessage("");
    setErrorField(null);
  }

  /** Runs the shared gate, then persists the draft for that step. */
  async function advance() {
    if (mutationRef.current) return;
    const result = onboardingAdvance({ step, draft, error: null, errorField: null }, context);
    if (result.error) {
      showError(result.error, result.errorField);
      return;
    }
    setErrorField(null);
    setMessage("");
    if (step === "profile") {
      // The birthday decides student protections and the role is a label, so a slip in either is
      // worth one question before it is saved.
      const question = roleAgeQuestion(draft.teamRole, draft.dateOfBirth);
      if (question) {
        mutationRef.current = true;
        const right = await askConfirm({
          title: "Check your role and birthday",
          body: `${question} Your birthday decides whether this is a student account; your role is how teammates see you.`,
          confirmLabel: "Yes, that's right",
          cancelLabel: "Let me fix it",
          tone: "neutral",
        }).finally(() => {
          mutationRef.current = false;
        });
        if (!right) {
          document.querySelector<HTMLInputElement>("input[type='date']")?.focus();
          return;
        }
      }
    }
    if (result.submit) {
      await finish();
      return;
    }
    const completedStep = step as "profile" | "team";
    mutationRef.current = true;
    setBusy(true);
    setMessage("");
    // `step: "profile"` is strict: the four profile fields plus the role picked on the same
    // screen. Crew and focus ride along with the team step.
    const body =
      completedStep === "profile"
        ? {
            step: "profile" as const,
            firstName: draft.firstName.trim(),
            lastName: draft.lastName.trim(),
            dateOfBirth: draft.dateOfBirth,
            gender: draft.gender,
            // Picked on this screen; saved with it so another tab still has it.
            teamRole: draft.teamRole || null,
          }
        : {
            step: "team" as const,
            preferredTeamNumber: submittedTeamNumber(draft, context),
            teamRole: draft.teamRole || null,
            crewRole: draft.crewRole || null,
            roleDescription: draft.roleDescription.trim() || null,
            primaryFocus: draft.primaryFocus,
          };
    try {
      const response = await fetch("/api/onboarding", {
        method: "PATCH",
        signal: AbortSignal.timeout(15_000),
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await response.json()) as OnboardingState & { error?: string };
      if (!response.ok) {
        showServerError(data.error ?? "Could not save this step. Press Continue to try again.");
        return;
      }
      if (!confirmedOnboardingState(data)) throw new Error("Progress could not be confirmed");
      // Keep the draft: it is what the person is looking at. Re-hydrating here copied the
      // server's older values back over fields this step does not save (a role picked on
      // step one rides along with step two), so "Coach" silently became "Student" again.
      setState(data);
      if (data.complete) routeCompleteState(data, false); else setStep(result.step);
    } catch {
      showError("We couldn't reach Vantage, so this step isn't saved yet. Your answers are still here. Check your connection and press Continue again.", null);
    } finally {
      mutationRef.current = false;
      setBusy(false);
    }
  }

  async function finish() {
    if (mutationRef.current) return;
    mutationRef.current = true;
    setBusy(true);
    setMessage("");
    try {
      if (!canSubmit) {
        const consentMessage =
          legalConsentMessage({ terms: draft.termsAccepted, privacy: draft.privacyAccepted }) ??
          "Agree to the Terms of Service and the Privacy Policy to submit your request.";
        setLegalError(consentMessage);
        showError(consentMessage, "legal");
        return;
      }
      const isTeamHead = Boolean(state?.isTeamHead);
      // Payload is byte-for-byte the contract `POST /api/onboarding` already validates.
      const response = await fetch("/api/onboarding", {
        method: "POST",
        signal: AbortSignal.timeout(15_000),
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          firstName: draft.firstName.trim(),
          lastName: draft.lastName.trim(),
          dateOfBirth: draft.dateOfBirth,
          gender: draft.gender,
          preferredTeamNumber: submittedTeamNumber(draft, context),
          teamRole: draft.teamRole || null,
          crewRole: draft.crewRole || null,
          roleDescription: draft.roleDescription.trim() || null,
          primaryFocus: draft.primaryFocus,
          displayName: draft.displayName.trim() || undefined,
          // Only a choice made here is saved as one; System stays on this device, as in Account.
          themePreference:
            themeTouched.current && draft.themePreference !== "system" ? draft.themePreference : undefined,
          termsAccepted: true,
          privacyAccepted: true,
          city: isTeamHead ? draft.orgCity.trim() || null : undefined,
          stateProv: isTeamHead ? draft.orgStateProv.trim() || null : undefined,
          description: isTeamHead ? draft.orgDescription.trim() || null : undefined,
          teamAffiliation: isTeamHead ? draft.teamAffiliation || null : undefined,
          fundingModel: isTeamHead && isFundingModel(draft.fundingModel) ? draft.fundingModel : undefined,
          schoolFunded: isTeamHead ? draft.schoolFunded : undefined,
          outsideGrants: isTeamHead ? draft.outsideGrants : undefined,
          sponsorsAllowed: isTeamHead ? draft.sponsorsAllowed : undefined,
        }),
      });
      const data = (await response.json()) as OnboardingState & { error?: string };
      if (!response.ok) {
        // An answer from an earlier screen (a birthday, the team's funding) goes back to it and
        // points at the field, instead of an error on a screen that has no way to fix it.
        showServerError(data.error ?? "Could not finish setting up your profile. Press the button again to retry.");
        return;
      }
      if (!confirmedOnboardingState(data) || data.complete !== true) throw new Error("Profile completion could not be confirmed");
      clearLocalAnswers(answersScope.current);
      hydrate(data);
      routeCompleteState(data, true);
    } catch {
      showError("We couldn't confirm that your profile was saved. Your answers are still here. Check your connection and try again.", null);
    } finally {
      mutationRef.current = false;
      setBusy(false);
    }
  }

  async function refreshApproval() {
    if (mutationRef.current) return;
    mutationRef.current = true;
    setChecking(true);
    setMessage("");
    try {
      const response = await fetch("/api/onboarding", { cache: "no-store", signal: AbortSignal.timeout(15_000) });
      if (response.status === 401) {
        setMessage("Your session ended. Sign in again to continue.");
        return;
      }
      const data = (await response.json()) as OnboardingState & { error?: string };
      if (!response.ok) {
        setMessage(data.error ?? "Could not check approval status.");
        return;
      }
      if (!confirmedOnboardingState(data)) throw new Error("Approval could not be confirmed");
      hydrate(data);
      if (data.accessStatus === "approved") {
        if (data.complete) routeCompleteState(data, false);
        else setStep(resumeOnboardingStep(data.currentStep, stepContextOf(data)));
      } else if (data.accessStatus === "invited") {
        setMessage("Your team invited you. Tap Join to finish.");
      } else if (data.accessStatus === "declined") {
        setMessage("This request was not approved. You can update the team number and request access again.");
      } else {
        setMessage("Still waiting for a team owner or administrator to review your request.");
      }
    } catch {
      setMessage("Could not check approval status. Try again in a moment.");
    } finally {
      mutationRef.current = false;
      setChecking(false);
    }
  }

  async function signOut() {
    if (mutationRef.current) return;
    mutationRef.current = true;
    setBusy(true);
    try { await signOutAndRedirect("/signin"); }
    finally { mutationRef.current = false; setBusy(false); }
  }

  if (loadStatus !== "ready" || !state) {
    const copy = onboardingLoadCopy(
      loadStatus === "setup_required" ? "setup_required" : loadStatus === "error" ? "error" : "loading",
      loadError,
    );
    return (
      <OnboardingLoadShell
        copy={copy}
        membershipTitle={state ? membershipNote.title : null}
        membershipBody={state ? membershipNote.body : null}
        onRetry={() => loadSession()}
      />
    );
  }

  const setupStep = step === "pending" || step === "done" ? null : step;
  const onTeamAlready = state?.accessStatus === "approved" || state?.accessStatus === "invited";
  const teamName = state?.lockedOrgName || state?.workspaceOrgName || null;
  const pendingPlan = buildOnboardingPendingPlan({
    accessStatus: state?.accessStatus,
    teamNumber: state?.preferredTeamNumber ?? null,
    orgName: teamName,
    workspaceMissing: state?.workspaceMissing,
    adult,
    platformAdmin: state?.platformAdmin,
    teamRequest: state?.teamRequest ?? null,
    bannedTeams: state?.bannedTeams ?? [],
  });
  const headerCopy =
    step === "done"
      ? // The owner's hand-off only: an invited mentor was told to "bring your team" with a
        // setup checklist that was the owner's.
        state?.workspaceRole === "owner"
        ? { eyebrow: "ALL SET", title: "You're in. Now bring your team.", sub: "Four steps make Vantage useful for everyone else. Start by inviting people." }
        : { eyebrow: "ALL SET", title: "You're in.", sub: "Home shows what to do now. Open it when you are ready." }
      : step === "pending"
        ? {
            eyebrow: pendingPlan.eyebrow,
            title: pendingPlan.headline,
            sub: pendingPlan.kind === "team_requested"
              ? "Your profile is saved. You'll get an email when Vantage approves the team."
              : pendingPlan.kind === "team_request_declined"
                ? "Your profile is saved. Check the team number, then ask again."
              : pendingPlan.kind === "banned"
                ? "Your account is fine. This team can't use Vantage right now."
              : pendingPlan.primaryAction.kind === "claim"
              ? "Create the team workspace if you are authorized to represent this team."
              : pendingPlan.kind === "platform_admin"
                ? "Your profile is saved. Add teams and their owners from the admin console."
              : pendingPlan.kind === "invited"
                ? "Your profile is saved. Join with the invitation sent to your verified email."
                : "Your profile is saved. Join by invitation or request access to an existing team.",
          }
        : onTeamAlready && state.isTeamHead
          ? {
              // The owner invite: they are setting the team up, not joining someone else's.
              // An invited mentor (admin) answering for a new team is not its owner.
              eyebrow: state.workspaceRole === "owner" ? "YOU'RE THE OWNER" : "YOU'RE A TEAM LEAD",
              // The stepper already counts the steps; the heading said it again.
              title: `Set up ${teamName ?? "your team"}.`,
              sub: "Tell us who you are, then Home walks you through inviting your team.",
            }
          : onTeamAlready && state?.accessStatus === "invited"
          ? {
              // Invited, not joined yet: finishing joins them. It said "You're on <team>" before
              // they had joined and never said with what access (QA A3-28).
              eyebrow: "YOU'RE INVITED",
              title: `Join ${teamName ?? "your team"}.`,
              sub: isAccessRole(state.workspaceRole)
                ? `Tell us who you are. When you finish, you join as ${roleLabel(state.workspaceRole)}: ${roleHint(state.workspaceRole).charAt(0).toLowerCase()}${roleHint(state.workspaceRole).slice(1)}`
                : "Tell us who you are. When you finish, you join the team.",
            }
          : onTeamAlready
          ? {
              // Someone who just accepted an invite was told their team "still
              // has to let you in" — the one thing that had already happened.
              eyebrow: "WELCOME TO THE TEAM",
              title: `You're on ${teamName ?? "the team"}.`,
              sub: "Tell us who you are and what you do, and Home will open on what to do first.",
            }
          : setupStep
            ? {
                eyebrow: "",
                ...GENERIC_STEP_HEADERS[setupStep],
                ...(setupStep === "preferences" && legalNeeded
                  ? { sub: "Make sure this looks right, then agree to the terms." }
                  : {}),
              }
            : {
                eyebrow: "WELCOME TO VANTAGE",
                title: "Make Vantage work for you.",
                sub: "A few questions. Your team still has to let you in before anything is shared.",
              };
  // The generic headers already say what the step is for; the hint under the progress bar
  // would repeat it.
  const showStepHint = Boolean(setupStep) && setupStep !== "profile" && headerCopy.eyebrow !== "";

  return (
    <main className="onboarding-page onboarding-flow-page scan-workbench scan-hub--onboarding">
      <section className={`onboarding-card onboarding-flow-card${step === "pending" || step === "done" ? " pending" : ""}`} aria-labelledby="onboarding-title">
        <header className="onboarding-flow-header">
          <div className="onboarding-brand"><VantageLogo /></div>
          {setupStep ? (
            <div className="onboarding-progress-block">
              <ol className="onboarding-steps onboarding-steps-simple onboarding-progress-bar" aria-label="Onboarding progress">
                {stepMeta.map((item) => (
                  <li key={item.id} className={item.phase} aria-current={item.phase === "current" ? "step" : undefined}>
                    <span className="sr-only">{item.label}{item.phase === "done" ? " (done)" : ""}</span>
                  </li>
                ))}
              </ol>
              <p className="onboarding-progress-label" aria-live="polite">{progressLabel}</p>
            </div>
          ) : null}
          {headerCopy.eyebrow ? <span>{headerCopy.eyebrow}</span> : null}
          <h1 id="onboarding-title" tabIndex={-1}>{headerCopy.title}</h1>
          <p className="onboarding-sub">{headerCopy.sub}</p>
          {showStepHint ? (
            <p className="onboarding-step-hint">{stepMeta.find((item) => item.phase === "current")?.description}</p>
          ) : null}
        </header>

        {/* On the setup screens a message is an error, shown by the form beside its field or
            above its buttons. Here only the waiting screen's status lines. */}
        {message && !setupStep ? <p className="onboarding-message" role="status">{message}</p> : null}
        {restoredFrom && setupStep ? (
          <p className="onboarding-resume-note">
            <b>Welcome back</b>
            <span>Your earlier answers are already filled in.</span>
          </p>
        ) : null}

        {step === "profile" ? (
          <ProfileForm
            draft={draft}
            patch={patch}
            errorField={errorField}
            message={message}
            busy={busy}
            pickRole={pickRole}
            pickCrew={pickCrew}
            onSubmit={() => void advance()}
          />
        ) : null}

        {step === "team" ? (
          <TeamForm
            draft={draft}
            patch={patch}
            lookup={lookup}
            locked={locked}
            busy={busy}
            isTeamHead={state.isTeamHead}
            errorField={errorField}
            errorMessage={message}
            onFocusTouch={() => {
              focusTouched.current = true;
            }}
            onBack={goBack}
            onSubmit={() => void advance()}
          />
        ) : null}

        {step === "preferences" ? (
          <PreferencesForm
            draft={draft}
            patch={patch}
            state={state}
            lookup={lookup}
            errorField={errorField}
            message={message}
            onThemeChange={pickTheme}
            legalNeeded={legalNeeded}
            legalError={legalError}
            setLegalError={setLegalError}
            canSubmit={canSubmit}
            busy={busy}
            onBack={goBack}
            onSubmit={() => void advance()}
          />
        ) : null}

        {step === "pending" ? (
          <PendingPanel
            state={state}
            adult={adult}
            checking={checking}
            busy={busy}
            onCheck={() => void refreshApproval()}
            onEdit={() => { setMessage(""); setStep("team"); }}
            onSignOut={() => void signOut()}
          />
        ) : null}

        {step === "done" ? <LandingPanel state={state} draft={draft} /> : null}
      </section>
    </main>
  );
}

/** What decides whether the team screen is shown, read from the server's state. */
function stepContextOf(data: OnboardingState): Pick<OnboardingStepContext, "locked" | "isTeamHead"> {
  return { locked: data.lockedTeamNumber != null, isTeamHead: Boolean(data.isTeamHead) };
}

/*
  Answers not yet accepted by the server stay private to this account and team.
  Legacy team-only drafts are not read because their author cannot be verified.
*/
type AnswersScope = { userId: string | null; orgId: string | null };
const answersStore = (scope: AnswersScope): Storage => (scope.orgId ? window.localStorage : window.sessionStorage);
type LocalAnswers = {
  firstName?: unknown;
  lastName?: unknown;
  teamRole?: unknown;
  crewRole?: unknown;
  roleDescription?: unknown;
  teamAffiliation?: unknown;
  fundingModel?: unknown;
  orgCity?: unknown;
  orgStateProv?: unknown;
};

function readLocalAnswers(scope: AnswersScope): LocalAnswers {
  try {
    const key = onboardingAnswersKey(scope.userId, scope.orgId);
    if (!key) return {};
    const raw = answersStore(scope).getItem(key);
    if (raw && raw.length > 10_000) return {};
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return parsed && typeof parsed === "object" ? (parsed as LocalAnswers) : {};
  } catch {
    return {};
  }
}

function saveLocalAnswers(draft: OnboardingDraft, scope: AnswersScope) {
  try {
    const key = onboardingAnswersKey(scope.userId, scope.orgId);
    if (!key) return;
    answersStore(scope).setItem(
      key,
      JSON.stringify({
        // A reload before Continue used to bring the role back but not the name typed above it.
        // Not the birthday: that is kept on the server only.
        firstName: draft.firstName.slice(0, 60),
        lastName: draft.lastName.slice(0, 60),
        teamRole: draft.teamRole,
        crewRole: draft.crewRole,
        roleDescription: draft.roleDescription,
        teamAffiliation: draft.teamAffiliation,
        // Funding is taken with Finish too; after a reload it came back unpicked beside a
        // "Welcome back, your answers are filled in" note.
        fundingModel: draft.fundingModel,
        orgCity: draft.orgCity,
        orgStateProv: draft.orgStateProv,
      }),
    );
  } catch {
    // Private mode: nothing kept, the server's answers still load.
  }
}

function clearLocalAnswers(scope: AnswersScope) {
  try {
    const key = onboardingAnswersKey(scope.userId, scope.orgId);
    if (key) answersStore(scope).removeItem(key);
  } catch {
    // Nothing to clear.
  }
}
