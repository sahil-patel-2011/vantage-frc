"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { VantageLogo } from "../../components/brand";
import {
  buildOnboardingStepMeta,
  defaultFocusForRole,
  emptyOnboardingDraft,
  isAdultRole,
  lookupTeamNumber,
  onboardingAdvance,
  onboardingCanSubmit,
  onboardingGoBack,
  onboardingLegalRequired,
  onboardingLoadCopy,
  onboardingMembershipNote,
  onboardingProgressLabel,
  submittedTeamNumber,
  type OnboardingCrew,
  type OnboardingDraft,
  type OnboardingFlowStep,
  type OnboardingRole,
  type OnboardingStepContext,
} from "../../lib/onboarding";
import {
  fundingModelFromFlags,
  isFundingModel,
} from "../../lib/funding-profile";
import { legalConsentMessage } from "../../lib/legal";
import { safeAppPath } from "../../lib/security/safe-navigation";
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
import { PreferencesForm, ProfileForm, TeamForm } from "./onboarding-steps";
import "./onboarding-flow.css";
import "../vantage-scan-auth.css";

export default function OnboardingClient() {
  const searchParams = useSearchParams();
  const [state, setState] = useState<OnboardingState | null>(null);
  const [step, setStep] = useState<OnboardingFlowStep>("profile");
  const [draft, setDraft] = useState<OnboardingDraft>(() => emptyOnboardingDraft());
  /** True once the person picked a focus themselves — stops the role default overriding them. */
  const focusTouched = useRef(false);
  const [message, setMessage] = useState("");
  const [errorField, setErrorField] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [legalError, setLegalError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadStatus, setLoadStatus] = useState<"loading" | "ready" | "error" | "setup_required">("loading");

  const patch = useCallback((next: Partial<OnboardingDraft>) => {
    setDraft((current) => {
      const merged = { ...current, ...next };
      saveLocalAnswers(merged);
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
    answersTeam = data.workspaceOrgId ?? null;
    const local = readLocalAnswers();
    setDraft((current) => ({
      ...current,
      firstName: data.firstName ?? current.firstName,
      lastName: data.lastName ?? current.lastName,
      dateOfBirth: data.dateOfBirth ?? current.dateOfBirth,
      gender: isGender(data.gender) ? data.gender : current.gender,
      // Someone the team made an owner or admin is not a student; start them on Mentor instead
      // of pre-picking Student for everyone.
      teamRole: isRole(data.teamRole)
        ? data.teamRole
        : typeof local.teamRole === "string" && isRole(local.teamRole)
          ? local.teamRole
          : data.isTeamHead || data.workspaceRole === "owner" || data.workspaceRole === "admin"
            ? "mentor"
            : current.teamRole,
      crewRole: isCrew(data.crewRole) ? data.crewRole : typeof local.crewRole === "string" && isCrew(local.crewRole) ? local.crewRole : current.crewRole,
      roleDescription: data.roleDescription ?? (typeof local.roleDescription === "string" ? local.roleDescription : current.roleDescription),
      teamNumber: String(data.lockedTeamNumber ?? data.preferredTeamNumber ?? current.teamNumber ?? ""),
      noTeam: data.complete && !data.lockedTeamNumber && data.preferredTeamNumber == null ? true : current.noTeam,
      primaryFocus: data.primaryFocus ?? current.primaryFocus,
      displayName: data.displayName ?? current.displayName,
      themePreference: data.themePreference ?? current.themePreference,
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
    }));
    if (data.primaryFocus) focusTouched.current = true;
  }, []);

  const approvedDestination = useCallback(
    (data: OnboardingState) => {
      const nextParam = searchParams.get("next");
      if (nextParam) return safeAppPath(nextParam, "/dashboard");
      if (data.workspaceOrgId) return `/dashboard?orgId=${encodeURIComponent(data.workspaceOrgId)}`;
      return data.platformAdmin ? "/admin" : "/workspace";
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
    setLoadStatus("loading");
    setLoadError(null);
    void fetch("/api/onboarding", { cache: "no-store" })
      .then(async (response) => {
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
        return (await response.json()) as OnboardingState;
      })
      .then((data) => {
        if (!data) return;
        hydrate(data);
        setLoadStatus("ready");
        if (data.complete) routeCompleteState(data, false);
        else if (data.currentStep === "team" || data.currentStep === "preferences") setStep(data.currentStep);
        else setStep("profile");
      })
      .catch(() => {
        setLoadStatus("error");
        setLoadError("Could not load onboarding. Check your connection and try again.");
        setState(null);
      });
  }, [hydrate, routeCompleteState]);

  useEffect(() => {
    loadSession();
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
  const stepMeta = useMemo(() => buildOnboardingStepMeta(step), [step]);
  const progressLabel = onboardingProgressLabel(step);
  const membershipNote = onboardingMembershipNote(state?.accessStatus ?? "none", {
    preferredTeamNumber: state?.preferredTeamNumber ?? lookup.teamNumber,
  });

  function pickRole(value: OnboardingRole) {
    const nextFocus = focusTouched.current ? draft.primaryFocus : defaultFocusForRole(value, draft.crewRole);
    patch({ teamRole: value, primaryFocus: nextFocus });
    setErrorField(null);
  }

  function pickCrew(value: OnboardingCrew) {
    const next = draft.crewRole === value ? "" : value;
    const nextFocus = focusTouched.current ? draft.primaryFocus : defaultFocusForRole(draft.teamRole, next);
    patch({ crewRole: next, primaryFocus: nextFocus });
  }

  function goBack() {
    const back = onboardingGoBack({ step, draft, error: null, errorField: null });
    setStep(back.step);
    setMessage("");
    setErrorField(null);
  }

  /** Runs the shared gate, then persists the draft for that step. */
  async function advance() {
    const result = onboardingAdvance({ step, draft, error: null, errorField: null }, context);
    if (result.error) {
      setMessage(result.error);
      setErrorField(result.errorField);
      // The message sits at the top of the card, often a screen above Continue: bring it (or
      // the field it is about) into view, or the press looked like it did nothing.
      window.requestAnimationFrame(() => {
        const target =
          document.querySelector<HTMLElement>("[aria-invalid='true']") ??
          document.querySelector<HTMLElement>(".onboarding-message.invalid");
        target?.scrollIntoView({ behavior: "smooth", block: "center" });
        if (target && target.matches("input, select, textarea")) target.focus({ preventScroll: true });
      });
      return;
    }
    setErrorField(null);
    if (result.submit) {
      await finish();
      return;
    }
    const completedStep = step as "profile" | "team";
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
            teamRole: draft.teamRole,
          }
        : {
            step: "team" as const,
            preferredTeamNumber: submittedTeamNumber(draft, context),
            teamRole: draft.teamRole,
            crewRole: draft.crewRole || null,
            roleDescription: draft.roleDescription.trim() || null,
            primaryFocus: draft.primaryFocus,
          };
    try {
      const response = await fetch("/api/onboarding", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await response.json()) as OnboardingState & { error?: string };
      if (!response.ok) {
        setMessage(data.error ?? "Could not save your progress.");
        return;
      }
      // Keep the draft: it is what the person is looking at. Re-hydrating here copied the
      // server's older values back over fields this step does not save (a role picked on
      // step one rides along with step two), so "Coach" silently became "Student" again.
      setState(data);
      setStep(result.step);
    } catch {
      setMessage("Could not save your progress. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function finish() {
    setBusy(true);
    setMessage("");
    try {
      if (!canSubmit) {
        const consentMessage =
          legalConsentMessage({ terms: draft.termsAccepted, privacy: draft.privacyAccepted }) ??
          "Agree to the Terms of Service and the Privacy Policy to submit your request.";
        setLegalError(consentMessage);
        setMessage(consentMessage);
        setErrorField("legal");
        return;
      }
      const isTeamHead = Boolean(state?.isTeamHead);
      // Payload is byte-for-byte the contract `POST /api/onboarding` already validates.
      const response = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          firstName: draft.firstName.trim(),
          lastName: draft.lastName.trim(),
          dateOfBirth: draft.dateOfBirth,
          gender: draft.gender,
          preferredTeamNumber: submittedTeamNumber(draft, context),
          teamRole: draft.teamRole,
          crewRole: draft.crewRole || null,
          roleDescription: draft.roleDescription.trim() || null,
          primaryFocus: draft.primaryFocus,
          displayName: draft.displayName.trim() || undefined,
          themePreference: draft.themePreference,
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
        const text = data.error ?? "Could not submit your access request.";
        // An answer from step two: go back to it and point at the field, instead of an error at
        // the top of a step that has no way to fix it.
        if (/affiliated|funding path|how the team is funded/i.test(text)) {
          setStep("team");
          setErrorField(/funded|funding/i.test(text) ? "fundingModel" : "teamAffiliation");
        }
        setMessage(text);
        window.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }
      clearLocalAnswers();
      hydrate(data);
      routeCompleteState(data, true);
    } finally {
      setBusy(false);
    }
  }

  async function refreshApproval() {
    setChecking(true);
    setMessage("");
    try {
      const response = await fetch("/api/onboarding", { cache: "no-store" });
      if (response.status === 401) {
        setMessage("Your session ended. Sign in again to continue.");
        return;
      }
      const data = (await response.json()) as OnboardingState & { error?: string };
      if (!response.ok) {
        setMessage(data.error ?? "Could not check approval status.");
        return;
      }
      hydrate(data);
      if (data.accessStatus === "approved") {
        setMessage("Approved. Your team access email is on its way — use its sign-in link to enter the team.");
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
      setChecking(false);
    }
  }

  async function signOut() {
    setBusy(true);
    await fetch("/api/auth/sign-out", { method: "POST" }).catch(() => undefined);
    window.location.assign("/signin");
  }

  if (loadStatus !== "ready" || !state) {
    const copy = onboardingLoadCopy(
      loadStatus === "setup_required" ? "setup_required" : loadStatus === "error" ? "error" : "loading",
      loadError,
    );
    return (
      <OnboardingLoadShell
        copy={copy}
        membershipTitle={membershipNote.title}
        membershipBody={membershipNote.body}
        onRetry={() => loadSession()}
      />
    );
  }

  const setupStep = step === "pending" || step === "done" ? null : step;
  const onTeamAlready = state?.accessStatus === "approved" || state?.accessStatus === "invited";
  const teamName = state?.lockedOrgName || state?.workspaceOrgName || null;
  const headerCopy =
    step === "done"
      ? state?.workspaceRole === "owner" || state?.workspaceRole === "admin"
        ? { eyebrow: "ALL SET", title: "You're in. Now bring your team.", sub: "Four steps make Vantage useful for everyone else. Start by inviting people." }
        : { eyebrow: "ALL SET", title: "You're in.", sub: "Home shows what to do now. Open it when you are ready." }
      : step === "pending"
        ? {
            eyebrow: "WAITING ON YOUR TEAM",
            title: "Your profile is ready. Team access is next.",
            sub: "A team number never lets you in by itself. A team owner or administrator must approve this account.",
          }
        : onTeamAlready && state.isTeamHead
          ? {
              // The owner invite: they are setting the team up, not joining someone else's.
              // An invited mentor (admin) answering for a new team is not its owner.
              eyebrow: state.workspaceRole === "owner" ? "YOU'RE THE OWNER" : "YOU'RE A TEAM LEAD",
              title: `Set up ${teamName ?? "your team"} in three steps.`,
              sub: "Tell us who you are, then Home walks you through inviting your team.",
            }
          : onTeamAlready
          ? {
              // Someone who just accepted an invite was told their team "still
              // has to let you in" — the one thing that had already happened.
              eyebrow: "WELCOME TO THE TEAM",
              title: `You're on ${teamName ?? "the team"}. Three steps to go.`,
              sub: "Tell us who you are and what you do, and Home will open on what to do first.",
            }
          : {
              eyebrow: "WELCOME TO VANTAGE",
              title: "Make Vantage work for you.",
              sub: "Three steps. Your team still has to let you in before anything is shared.",
            };

  return (
    <main className="onboarding-page onboarding-flow-page scan-workbench scan-hub--onboarding">
      <section className={`onboarding-card onboarding-flow-card${step === "pending" || step === "done" ? " pending" : ""}`} aria-labelledby="onboarding-title">
        <header className="onboarding-flow-header">
          <div className="onboarding-brand"><VantageLogo /></div>
          <span>{headerCopy.eyebrow}</span>
          <h1 id="onboarding-title">{headerCopy.title}</h1>
          <p className="onboarding-sub">{headerCopy.sub}</p>
        </header>

        {setupStep ? (
          <div className="onboarding-progress-block">
            <p className="onboarding-progress-label" aria-live="polite">{progressLabel}</p>
            <ol className="onboarding-steps onboarding-steps-simple scan-rail" aria-label="Onboarding progress">
              {stepMeta.map((item) => (
                <li key={item.id} className={item.phase} aria-current={item.phase === "current" ? "step" : undefined}>
                  <b aria-hidden="true">{item.phase === "done" ? "✓" : item.index + 1}</b>
                  <span>{item.label}</span>
                </li>
              ))}
            </ol>
            <p className="onboarding-step-hint">{stepMeta.find((item) => item.phase === "current")?.description}</p>
          </div>
        ) : null}

        {message ? (
          <p className={`onboarding-message${errorField ? " invalid" : ""}`} role="status">{message}</p>
        ) : null}
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

/*
  Answers the server takes only with a later step, kept on this device. With a team (an owner or
  an invited member) they go in localStorage under that team, so opening onboarding in a new tab
  gets them back; without one, only for this browser session, so a shared computer does not hand
  them to the next person.
*/
let answersTeam: string | null = null;
const answersKey = () => `vantage.onboarding.answers${answersTeam ? `:${answersTeam}` : ""}`;
const answersStore = (): Storage => (answersTeam ? window.localStorage : window.sessionStorage);
type LocalAnswers = {
  teamRole?: unknown;
  crewRole?: unknown;
  roleDescription?: unknown;
  teamAffiliation?: unknown;
  fundingModel?: unknown;
  orgCity?: unknown;
  orgStateProv?: unknown;
};

function readLocalAnswers(): LocalAnswers {
  try {
    const raw = answersStore().getItem(answersKey());
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return parsed && typeof parsed === "object" ? (parsed as LocalAnswers) : {};
  } catch {
    return {};
  }
}

function saveLocalAnswers(draft: OnboardingDraft) {
  try {
    answersStore().setItem(
      answersKey(),
      JSON.stringify({
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

function clearLocalAnswers() {
  try {
    answersStore().removeItem(answersKey());
  } catch {
    // Nothing to clear.
  }
}
